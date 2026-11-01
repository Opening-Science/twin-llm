import type { AppendInput } from "@/packages/audit/append";

import type { LlmProvider } from "./data-mode-policy";
import {
  blocksSend,
  type CheckFreeText,
  GENOME_IDS_BLOCKED_SENTENCE,
  type FreeTextCheck,
  hasGenomeShapedText,
  requestText,
} from "./free-text-check";

/**
 * The disclosure ledger (#140, docs/privacy-design.md 2.5): what left this
 * machine, to whom, for what, and how much of it; never the content.
 *
 * Every outbound path calls one function, `recordDisclosure`
 * (`disclosure-ledger-runtime.ts`), before it sends. It writes the ledger
 * row and its paired audit row in one transaction; when that fails it throws
 * `DisclosureNotRecordedError` and the caller does not send. The table of
 * outbound paths is `tests/disclosures/outbound-paths.test.ts`.
 *
 * Pure: the types, the audit row, the recorder over an injected writer, and
 * the cumulative view. No database and no clock.
 */

export const DISCLOSURE_KINDS = [
  "hosted-model",
  "vendor-sync",
  "vendor-auth",
  "export-file",
  "ark-release",
  "remote-tool",
  "embedding",
  "telemetry",
  "public-lookup",
] as const;

export type DisclosureKind = (typeof DISCLOSURE_KINDS)[number];

/**
 * `blocked`: a request that was stopped before it was sent (#356), recorded
 * so the person can see what would have gone. Nothing left this machine.
 */
export type DisclosureDirection = "sent" | "received" | "blocked";

/** The direction as the Privacy page and the Lab card name it. */
export const directionLabel = (value: string): "Sent" | "Received" | "Blocked" =>
  value === "received" ? "Received" : value === "blocked" ? "Blocked" : "Sent";

/** What a request carried, in words a person reads. Fixed strings only. */
export const CATEGORY = {
  question: "question text",
  history: "earlier messages",
  answers: "answers",
  wearable: "wearable summary",
  scan: "body scan summary",
  notes: "twin notes",
  tools: "tool results",
  accessToken: "access token",
  dateWindow: "date window",
  authCode: "authorization code",
  onboarding: "onboarding answers",
  genome: "genome report",
  population: "population question",
  searchText: "search text",
  usage: "usage ids and counts",
  searchTerms: "search terms",
  publicIds: "public record ids",
} as const;

export type DisclosureCategory = (typeof CATEGORY)[keyof typeof CATEGORY];

/** Where a referenced value is stored. */
export type RefSource = "wearable" | "scan" | "import" | "genome" | "note" | "chat";

/**
 * One stored value a request carried, as a reference: a metric key with its
 * date (`oura.hrv_rmssd.2026-10-20`) or a row id. Never the value itself.
 */
export type ValueRef = Readonly<{ source: RefSource; key: string }>;

export type Disclosure = Readonly<{
  actor: string;
  /** The session of the paired audit row: a turn id, a thread id or a fresh id. */
  sessionId: string;
  kind: DisclosureKind;
  /** Left out: sent. `blocked`: stopped before the send (#356). */
  direction?: DisclosureDirection;
  recipient: string;
  /** The model id, request kind or file format. */
  target: string | null;
  purpose: string;
  categories: readonly DisclosureCategory[];
  refs: readonly ValueRef[];
  /** Request or file size; null when it could not be measured. */
  payloadBytes: number | null;
  threadId: string | null;
  /** True when the request carried synthetic data only. */
  synthetic: boolean;
  /**
   * What the check of the request's free text for stored values found
   * (#346): kinds and counts only. Left out: the text was not checked.
   */
  freeText?: FreeTextCheck;
}>;

export type DisclosureReceipt = Readonly<{ seq: bigint; auditSeq: bigint }>;

/**
 * Records one disclosure before the send. `paired` is the audit row the
 * path already writes for this event (a thread export's `thread.export`);
 * left out, `disclosureAuditEvent` is written. Rejects with
 * `DisclosureNotRecordedError` when nothing was written.
 */
export type RecordDisclosure = (
  disclosure: Disclosure,
  paired?: AppendInput,
) => Promise<DisclosureReceipt>;

/** Writes the ledger row and the audit row in one transaction. */
export type DisclosureWriter = (
  disclosure: Disclosure,
  audit: AppendInput,
) => Promise<DisclosureReceipt>;

export class DisclosureNotRecordedError extends Error {
  /** The name of the error underneath, never its message. */
  readonly reason: string;
  constructor(reason: string) {
    super("The disclosure ledger could not be written, so nothing was sent.");
    this.name = "DisclosureNotRecordedError";
    this.reason = reason;
  }
}

/** The audit row paired with a ledger row: kind and recipient, counts, no content. */
export const disclosureAuditEvent = (disclosure: Disclosure): AppendInput => ({
  actor: disclosure.actor,
  sessionId: disclosure.sessionId,
  subjectRef: null,
  tool: `disclosure.${disclosure.kind}`,
  args: {
    recipient: disclosure.recipient,
    target: disclosure.target,
    purpose: disclosure.purpose,
  },
  result: {
    direction: disclosure.direction ?? "sent",
    categories: [...disclosure.categories],
    bytes: disclosure.payloadBytes,
    synthetic: disclosure.synthetic,
    ...(disclosure.freeText === undefined
      ? {}
      : { freeText: disclosure.freeText.matches.map((match) => ({ ...match })) }),
  },
  rowCount: disclosure.refs.length,
});

const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : "unknown";

/** A refusal before any write: a disclosure that would be wrong on its face. */
const problemOf = (disclosure: Disclosure): string | null => {
  if (disclosure.actor.trim() === "") return "no actor";
  if (disclosure.recipient.trim() === "") return "no recipient";
  if (disclosure.categories.length === 0) return "no category";
  if (
    disclosure.payloadBytes !== null &&
    (!Number.isInteger(disclosure.payloadBytes) || disclosure.payloadBytes < 0)
  ) {
    return "bad size";
  }
  return null;
};

export const createRecordDisclosure =
  (writer: DisclosureWriter): RecordDisclosure =>
  async (disclosure, paired) => {
    const problem = problemOf(disclosure);
    if (problem !== null) throw new DisclosureNotRecordedError(problem);
    try {
      return await writer(disclosure, paired ?? disclosureAuditEvent(disclosure));
    } catch (error) {
      throw new DisclosureNotRecordedError(errorName(error));
    }
  };

// ─── Hosted models ──────────────────────────────────────────────────────────

/**
 * What a model call's caller knows about the request: who, why, and what it
 * carries. `resolveLanguageModel` adds the recipient, the model id and each
 * HTTP request's size, and records one row per request before it goes out.
 */
export type ModelDisclosure = Omit<
  Disclosure,
  "kind" | "direction" | "recipient" | "target" | "payloadBytes" | "freeText"
>;

/**
 * A model call that is deliberately not recorded, with the reason. Only the
 * evaluation harness passes one (synthetic cohorts, its own database); the
 * outbound-paths test lists every caller that may.
 */
export type UnrecordedModelCall = Readonly<{ notRecorded: string }>;

/** Who receives a chat model's requests, or null when it runs on this machine. */
export const modelRecipient = (
  provider: LlmProvider,
  ollamaOnLoopback: boolean,
): string | null =>
  provider === "ollama"
    ? ollamaOnLoopback
      ? null
      : "ollama on another machine"
    : provider;

/** The size of a fetch body in bytes, or null when it cannot be measured up front. */
export const bodyBytes = (body: unknown): number | null => {
  if (body === undefined || body === null) return 0;
  if (typeof body === "string") return Buffer.byteLength(body, "utf8");
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  if (body instanceof URLSearchParams) {
    return Buffer.byteLength(body.toString(), "utf8");
  }
  if (body instanceof Blob) return body.size;
  return null;
};

/**
 * A fetch that records each request before it is made. `record` gets the
 * body's size and the body itself (to check, never to store). When `record`
 * rejects, the request is not made and the fetch rejects with the
 * recorder's error.
 */
export const ledgeredFetch =
  (
    fetchFn: typeof fetch,
    record: (payloadBytes: number | null, body: unknown) => Promise<unknown>,
  ): typeof fetch =>
  async (input, init) => {
    await record(bodyBytes(init?.body), init?.body);
    return fetchFn(input, init);
  };

/** What the free text check of one request came to (#346). */
export type FreeTextOutcome =
  | Readonly<{ status: "checked"; check: FreeTextCheck }>
  /** No checker, or a body that cannot be read up front. */
  | Readonly<{ status: "not-checked" }>
  /** The check failed (a locked vault); `genomeShaped` when the text held rsID- or site-shaped text. */
  | Readonly<{ status: "failed"; genomeShaped: boolean }>;

/**
 * Checks a request body's free text for stored values (#346). Not checked
 * when there is no checker or the body cannot be read up front. A check
 * that fails is logged by the error's name only.
 */
export const checkRequestText = async (
  check: CheckFreeText | undefined,
  body: unknown,
): Promise<FreeTextOutcome> => {
  if (check === undefined) return { status: "not-checked" };
  const text = requestText(body);
  if (text === null) return { status: "not-checked" };
  try {
    return { status: "checked", check: await check(text) };
  } catch (error) {
    console.error("free text check failed", errorName(error));
    return { status: "failed", genomeShaped: hasGenomeShapedText(text) };
  }
};

/**
 * Whether a request may go, and what its row records (#356). Blocked when
 * the check found the person's own rsIDs or genome sites, or when the check
 * failed on text that holds rsID- or site-shaped text (fail closed: it
 * cannot be told apart from the person's own). Any other match, and a
 * failed check on other text, is recorded and the request goes.
 */
export const sendDecision = (
  outcome: FreeTextOutcome,
): Readonly<{ blocked: boolean; freeText?: FreeTextCheck }> => {
  if (outcome.status === "checked") {
    return { blocked: blocksSend(outcome.check), freeText: outcome.check };
  }
  return { blocked: outcome.status === "failed" && outcome.genomeShaped };
};

export const GENOME_IDS_BLOCKED = "GENOME_IDS_BLOCKED" as const;

/**
 * A request to a hosted model that was not sent because it carried the
 * person's own genome identifiers (#356). Its message is the fixed sentence
 * the person reads, never anything from the request.
 */
export class GenomeIdsBlockedError extends Error {
  readonly code = GENOME_IDS_BLOCKED;
  constructor() {
    super(GENOME_IDS_BLOCKED_SENTENCE);
    this.name = "GenomeIdsBlockedError";
  }
}

/**
 * True when the error, or one it wraps (a `cause`, or the AI SDK's retry
 * error's `lastError`), is a blocked send.
 */
export const isGenomeIdsBlocked = (error: unknown, depth = 0): boolean => {
  if (depth > 5 || typeof error !== "object" || error === null) return false;
  if (error instanceof GenomeIdsBlockedError) return true;
  if ("code" in error && error.code === GENOME_IDS_BLOCKED) return true;
  const inner = [
    "cause" in error ? error.cause : undefined,
    "lastError" in error ? error.lastError : undefined,
  ];
  return inner.some((each) => isGenomeIdsBlocked(each, depth + 1));
};

/**
 * The fetch a model call sends through: the plain one for a model on this
 * machine (`recipient` null) or a call the caller states is not recorded,
 * else one that records a `hosted-model` row per HTTP request, with the
 * request's size and, given `checkText`, what the check of its free text
 * found (#346), before it goes out. A request that carries the person's own
 * genome identifiers is not sent (#356, `sendDecision`): its row is written
 * as `blocked` and the fetch rejects with `GenomeIdsBlockedError`.
 */
export const modelCallFetch = (
  fetchFn: typeof fetch,
  call: Readonly<{
    recipient: string | null;
    modelId: string;
    disclosure: ModelDisclosure | UnrecordedModelCall;
    record: RecordDisclosure;
    checkText?: CheckFreeText;
  }>,
): typeof fetch => {
  const { recipient, disclosure } = call;
  if (recipient === null || "notRecorded" in disclosure) return fetchFn;
  return ledgeredFetch(fetchFn, async (payloadBytes, body) => {
    const { blocked, freeText } = sendDecision(
      await checkRequestText(call.checkText, body),
    );
    const row: Disclosure = {
      ...disclosure,
      kind: "hosted-model",
      ...(blocked ? { direction: "blocked" } : {}),
      recipient,
      target: call.modelId,
      payloadBytes,
      ...(freeText === undefined ? {} : { freeText }),
    };
    if (!blocked) return call.record(row);
    // Nothing is sent either way; a row that cannot be written is only logged.
    await call.record(row).catch((error: unknown) => {
      console.error("blocked model request not recorded", errorName(error));
    });
    throw new GenomeIdsBlockedError();
  });
};

/**
 * One server-side PostHog event: ids, counts and statuses, never text
 * (`analytics-events.ts`, `generation-analytics.ts`).
 */
export const telemetryDisclosure = (
  event: Readonly<{ distinctId: string; event: string; synthetic: boolean }>,
): Disclosure => ({
  actor: event.distinctId,
  sessionId: event.event,
  kind: "telemetry",
  recipient: "PostHog",
  target: event.event,
  purpose: "product analytics",
  categories: [CATEGORY.usage],
  refs: [],
  payloadBytes: null,
  threadId: null,
  synthetic: event.synthetic,
});

// ─── The cumulative view ────────────────────────────────────────────────────

/** A ledger row as the views read it: no `refs`, no hashes. */
export type LedgerEntry = Readonly<{
  seq: bigint | number;
  ts: Date;
  kind: string;
  direction: string;
  recipient: string;
  target: string | null;
  purpose: string;
  categories: readonly string[];
  refCount: number;
  payloadBytes: number | null;
  threadId: string | null;
  synthetic: boolean;
  freeTextChecked: boolean;
  /** Kinds and counts the free text check found; null when it did not run. */
  freeTextMatches: unknown;
}>;

export type RecipientTotal = Readonly<{
  recipient: string;
  direction: DisclosureDirection;
  events: number;
  /** Of `events`, how many carried synthetic data only. */
  syntheticEvents: number;
  /** Stored values the events carried, counted once per event. */
  refs: number;
  /** Bytes of the events whose size was measured. */
  bytes: number;
  /** Events whose size could not be measured. */
  unmeasured: number;
  first: Date;
  last: Date;
  /** Category to the number of events that carried it, in first-seen order. */
  categories: readonly Readonly<{ category: string; events: number }>[];
}>;

const directionOf = (value: string): DisclosureDirection =>
  value === "received" ? "received" : value === "blocked" ? "blocked" : "sent";

const addCategories = (
  counts: RecipientTotal["categories"],
  categories: readonly string[],
): RecipientTotal["categories"] =>
  categories.reduce(
    (list, category) =>
      list.some((item) => item.category === category)
        ? list.map((item) =>
            item.category === category ? { ...item, events: item.events + 1 } : item,
          )
        : [...list, { category, events: 1 }],
    counts,
  );

/**
 * Running totals per recipient and direction, most recent first. Entries
 * may come in any order.
 */
export const ledgerTotals = (
  entries: readonly LedgerEntry[],
): readonly RecipientTotal[] => {
  const totals = entries.reduce((map, entry) => {
    const direction = directionOf(entry.direction);
    const key = `${direction}|${entry.recipient}`;
    const known = map.get(key);
    const base: RecipientTotal = known ?? {
      recipient: entry.recipient,
      direction,
      events: 0,
      syntheticEvents: 0,
      refs: 0,
      bytes: 0,
      unmeasured: 0,
      first: entry.ts,
      last: entry.ts,
      categories: [],
    };
    return new Map(map).set(key, {
      ...base,
      events: base.events + 1,
      syntheticEvents: base.syntheticEvents + (entry.synthetic ? 1 : 0),
      refs: base.refs + entry.refCount,
      bytes: base.bytes + (entry.payloadBytes ?? 0),
      unmeasured: base.unmeasured + (entry.payloadBytes === null ? 1 : 0),
      first: entry.ts < base.first ? entry.ts : base.first,
      last: entry.ts > base.last ? entry.ts : base.last,
      categories: addCategories(base.categories, entry.categories),
    });
  }, new Map<string, RecipientTotal>());
  return [...totals.values()].sort(
    (a, b) =>
      b.last.getTime() - a.last.getTime() || a.recipient.localeCompare(b.recipient),
  );
};
