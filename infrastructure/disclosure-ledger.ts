import type { AppendInput } from "@/packages/audit/append";

import type { LlmProvider } from "./data-mode-policy";

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
] as const;

export type DisclosureKind = (typeof DISCLOSURE_KINDS)[number];

export type DisclosureDirection = "sent" | "received";

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
  /** Left out: sent. */
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
  "kind" | "direction" | "recipient" | "target" | "payloadBytes"
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
 * A fetch that records each request before it is made. When `record`
 * rejects, the request is not made and the fetch rejects with the
 * recorder's error.
 */
export const ledgeredFetch =
  (
    fetchFn: typeof fetch,
    record: (payloadBytes: number | null) => Promise<unknown>,
  ): typeof fetch =>
  async (input, init) => {
    await record(bodyBytes(init?.body));
    return fetchFn(input, init);
  };

/**
 * The fetch a model call sends through: the plain one for a model on this
 * machine (`recipient` null) or a call the caller states is not recorded,
 * else one that records a `hosted-model` row per HTTP request, with the
 * request's size, before it goes out.
 */
export const modelCallFetch = (
  fetchFn: typeof fetch,
  call: Readonly<{
    recipient: string | null;
    modelId: string;
    disclosure: ModelDisclosure | UnrecordedModelCall;
    record: RecordDisclosure;
  }>,
): typeof fetch => {
  const { recipient, disclosure } = call;
  if (recipient === null || "notRecorded" in disclosure) return fetchFn;
  return ledgeredFetch(fetchFn, (payloadBytes) =>
    call.record({
      ...disclosure,
      kind: "hosted-model",
      recipient,
      target: call.modelId,
      payloadBytes,
    }),
  );
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
  value === "received" ? "received" : "sent";

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
