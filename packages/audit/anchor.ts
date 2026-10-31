import {
  createHash,
  createPublicKey,
  type KeyObject,
  sign as signBytes,
  verify as verifyBytes,
} from "node:crypto";

import { z } from "zod";

import { GENESIS_PREV_HASH, sha256Hex, toCanonicalJson } from "./hash";
import { CHAINS, type ChainName } from "./chain";

/**
 * Signed anchors for the audit chain and the disclosure ledger (#300,
 * docs/privacy-design.md section 2.6). The hash chains catch an edited or
 * removed row in the middle, but not a chain cut short or rebuilt from the
 * start, because nothing outside the database remembers the head. An anchor
 * is that memory: the chain's head (`seq`, `hash`, the row's time), signed
 * with an Ed25519 key that lives in the state folder, one JSON line each in
 * an append-only file. Anchors never leave the machine on their own.
 *
 * The file holds three kinds of line, each pointing at the one before by
 * `prev` (SHA-256 of its canonical JSON), so a removed line shows:
 *
 * - `key`: the first line, naming the first public key, signed by it.
 * - `anchor`: one chain's head, signed by the current key.
 * - `rotation`: a new key, signed by the old one; or, when the old key is
 *   lost or exposed, signed by the new one only (`withoutOldKey`), which is
 *   a break in continuity and never counts as OK.
 *
 * Pure: keys come in as objects or text, the clock and the files come in as
 * data. `anchor-store.ts` reads and writes the files.
 */

export const ANCHOR_VERSION = 1;

export type ChainHead = Readonly<{ seq: number; hash: string; ts: string }>;

const hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const base64Text = z.string().regex(/^[A-Za-z0-9+/_-]+={0,2}$/);

const common = {
  v: z.literal(ANCHOR_VERSION),
  at: z.string(),
  keyId: hex64,
  prev: hex64,
  sig: base64Text,
};

const recordSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("key"), ...common, publicKey: base64Text }).strict(),
  z
    .object({
      kind: z.literal("anchor"),
      ...common,
      chain: z.enum(CHAINS),
      seq: z.number().int().positive(),
      hash: hex64,
      headTs: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("rotation"),
      ...common,
      newKeyId: hex64,
      newPublicKey: base64Text,
      withoutOldKey: z.boolean(),
    })
    .strict(),
]);

export type AnchorLine = Readonly<z.infer<typeof recordSchema>>;
export type AnchorRecord = Extract<AnchorLine, { kind: "anchor" }>;
export type KeyRecord = Extract<AnchorLine, { kind: "key" }>;
export type RotationRecord = Extract<AnchorLine, { kind: "rotation" }>;

type Unsigned<T> = Omit<T, "sig">;

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/** A public key as written in the file: base64 of its SPKI DER bytes. */
export const publicKeyText = (key: KeyObject): string =>
  key.export({ type: "spki", format: "der" }).toString("base64");

/** The key id: SHA-256 of the public key's SPKI DER bytes, in hex. */
export const keyIdOf = (publicKey: string): string =>
  createHash("sha256").update(Buffer.from(publicKey, "base64")).digest("hex");

/** Public keys this machine trusts, by key id: the current one and retired ones. */
export type KnownKeys = ReadonlyMap<string, string>;

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/** The bytes a signature covers: the canonical JSON of the line without `sig`. */
const signedBytes = (body: Readonly<Record<string, unknown>>): Buffer =>
  Buffer.from(toCanonicalJson(body), "utf8");

export const signLine = <T extends AnchorLine>(
  body: Unsigned<T>,
  privateKey: KeyObject,
): T =>
  ({
    ...body,
    sig: signBytes(null, signedBytes(body), privateKey).toString("base64url"),
  }) as T;

/** True when `line.sig` is a valid Ed25519 signature by `publicKey` over the line. */
export const signatureHolds = (line: AnchorLine, publicKey: string): boolean => {
  const { sig, ...body } = line;
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKey, "base64"),
      format: "der",
      type: "spki",
    });
    return verifyBytes(null, signedBytes(body), key, Buffer.from(sig, "base64url"));
  } catch {
    return false;
  }
};

/** What the next line's `prev` must be. */
export const lineHash = (line: AnchorLine): string => sha256Hex(toCanonicalJson(line));

export const serializeLine = (line: AnchorLine): string => `${toCanonicalJson(line)}\n`;

export const parseLine = (text: string): AnchorLine | null => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = recordSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

/** The lines of the file; a final newline does not make an empty line. */
export const splitLines = (text: string): readonly string[] => {
  const lines = text.split("\n");
  return lines.at(-1) === "" ? lines.slice(0, -1) : lines;
};

export const keyBody = (
  input: Readonly<{ publicKey: string; at: string; prev: string }>,
): Unsigned<KeyRecord> => ({
  v: ANCHOR_VERSION,
  kind: "key",
  at: input.at,
  keyId: keyIdOf(input.publicKey),
  prev: input.prev,
  publicKey: input.publicKey,
});

export const anchorBody = (
  input: Readonly<{
    chain: ChainName;
    head: ChainHead;
    at: string;
    keyId: string;
    prev: string;
  }>,
): Unsigned<AnchorRecord> => ({
  v: ANCHOR_VERSION,
  kind: "anchor",
  at: input.at,
  keyId: input.keyId,
  prev: input.prev,
  chain: input.chain,
  seq: input.head.seq,
  hash: input.head.hash,
  headTs: input.head.ts,
});

/**
 * A new key. Signed by the old key (`keyId` is the old key's id), or, with
 * `withoutOldKey`, by the new key itself (`keyId` is the new key's id).
 */
export const rotationBody = (
  input: Readonly<{
    oldKeyId: string | null;
    newPublicKey: string;
    at: string;
    prev: string;
  }>,
): Unsigned<RotationRecord> => {
  const newKeyId = keyIdOf(input.newPublicKey);
  return {
    v: ANCHOR_VERSION,
    kind: "rotation",
    at: input.at,
    keyId: input.oldKeyId ?? newKeyId,
    prev: input.prev,
    newKeyId,
    newPublicKey: input.newPublicKey,
    withoutOldKey: input.oldKeyId === null,
  };
};

// ---------------------------------------------------------------------------
// The file, line by line
// ---------------------------------------------------------------------------

export type CurrentKey = Readonly<{ keyId: string; publicKey: string }>;

export type AnchorLogState = Readonly<{
  lines: number;
  /** The hash of the last line, which the next line must name as `prev`. */
  prev: string;
  /** The key the next line must be signed with; null before the `key` line. */
  key: CurrentKey | null;
  /** Every key the file has used, oldest first. */
  keyIds: readonly string[];
  latest: Readonly<Partial<Record<ChainName, AnchorRecord>>>;
  /** Line numbers (from 1) of rotations made without the old key. */
  breaks: readonly number[];
}>;

export const ANCHOR_LOG_START: AnchorLogState = {
  lines: 0,
  prev: GENESIS_PREV_HASH,
  key: null,
  keyIds: [],
  latest: {},
  breaks: [],
};

export const LOG_PROBLEMS = [
  "unreadable",
  "bad-link",
  "bad-signature",
  "unknown-key",
  "no-key-line",
  "second-key-line",
] as const;

export type LogProblemReason = (typeof LOG_PROBLEMS)[number];

export type LogProblem = Readonly<{ line: number; reason: LogProblemReason }>;

export type LogStep =
  | Readonly<{ ok: true; state: AnchorLogState }>
  | Readonly<{ ok: false; problem: LogProblem }>;

const fail = (line: number, reason: LogProblemReason): LogStep => ({
  ok: false,
  problem: { line, reason },
});

const trusted = (known: KnownKeys, keyId: string, publicKey: string): boolean =>
  keyIdOf(publicKey) === keyId && known.get(keyId) === publicKey;

/** One line of the file checked against the state the lines before it left. */
export const stepAnchorLog = (
  state: AnchorLogState,
  text: string,
  known: KnownKeys,
): LogStep => {
  const at = state.lines + 1;
  const line = parseLine(text);
  if (line === null) return fail(at, "unreadable");
  if (line.prev !== state.prev) return fail(at, "bad-link");
  const advance = (change: Partial<AnchorLogState>): LogStep => ({
    ok: true,
    state: { ...state, ...change, lines: at, prev: lineHash(line) },
  });

  switch (line.kind) {
    case "key": {
      if (state.key !== null) return fail(at, "second-key-line");
      if (!trusted(known, line.keyId, line.publicKey)) return fail(at, "unknown-key");
      if (!signatureHolds(line, line.publicKey)) return fail(at, "bad-signature");
      return advance({
        key: { keyId: line.keyId, publicKey: line.publicKey },
        keyIds: [...state.keyIds, line.keyId],
      });
    }
    case "anchor": {
      if (state.key === null) return fail(at, "no-key-line");
      if (line.keyId !== state.key.keyId) return fail(at, "unknown-key");
      if (!signatureHolds(line, state.key.publicKey)) return fail(at, "bad-signature");
      return advance({ latest: { ...state.latest, [line.chain]: line } });
    }
    case "rotation": {
      const next = { keyId: line.newKeyId, publicKey: line.newPublicKey };
      if (line.withoutOldKey) {
        if (line.keyId !== line.newKeyId || !trusted(known, next.keyId, next.publicKey)) {
          return fail(at, "unknown-key");
        }
        if (!signatureHolds(line, next.publicKey)) return fail(at, "bad-signature");
        return advance({
          key: next,
          keyIds: [...state.keyIds, next.keyId],
          breaks: [...state.breaks, at],
        });
      }
      if (state.key === null) return fail(at, "no-key-line");
      if (line.keyId !== state.key.keyId || keyIdOf(next.publicKey) !== next.keyId) {
        return fail(at, "unknown-key");
      }
      if (!signatureHolds(line, state.key.publicKey)) return fail(at, "bad-signature");
      return advance({ key: next, keyIds: [...state.keyIds, next.keyId] });
    }
  }
};

export type AnchorLogCheck =
  | Readonly<{ ok: true; state: AnchorLogState }>
  | Readonly<{ ok: false; problem: LogProblem; state: AnchorLogState }>;

const runLog = (
  lines: readonly string[],
  start: AnchorLogState,
  known: KnownKeys,
): AnchorLogCheck => {
  let state = start;
  for (const text of lines.slice(start.lines)) {
    const step = stepAnchorLog(state, text, known);
    if (!step.ok) return { ok: false, problem: step.problem, state };
    state = step.state;
  }
  return { ok: true, state };
};

const isBreakLine = (text: string): boolean => {
  const line = parseLine(text);
  return line !== null && line.kind === "rotation" && line.withoutOldKey;
};

/**
 * Every line in order; stops at the first that does not hold. A rotation
 * without the old key at or after that line starts the check over from
 * there: the lines before it cannot be tied to the new key, which the
 * verdict reports as a break (Unknown), not as a pass.
 */
export const checkAnchorLog = (
  lines: readonly string[],
  known: KnownKeys,
): AnchorLogCheck => {
  const first = runLog(lines, ANCHOR_LOG_START, known);
  if (first.ok) return first;
  const restart = lines.reduce(
    (found, text, index) =>
      index >= first.problem.line - 1 && isBreakLine(text) ? index : found,
    -1,
  );
  if (restart === -1) return first;
  const line = parseLine(lines[restart]);
  if (line === null) return first;
  return runLog(lines, { ...ANCHOR_LOG_START, lines: restart, prev: line.prev }, known);
};

/**
 * The newest anchor per chain and the last line's hash, read without checking
 * signatures: enough for the writer to decide and to link the next line.
 * Null when a line does not parse, so nothing is appended to a damaged file.
 */
export const scanAnchorLog = (
  lines: readonly string[],
): Readonly<{
  prev: string;
  latest: Partial<Record<ChainName, AnchorRecord>>;
  keyId: string | null;
}> | null => {
  const parsed = lines.map(parseLine);
  if (parsed.some((line) => line === null)) return null;
  return (parsed as AnchorLine[]).reduce<{
    prev: string;
    latest: Partial<Record<ChainName, AnchorRecord>>;
    keyId: string | null;
  }>(
    (scan, line) => ({
      prev: lineHash(line),
      latest:
        line.kind === "anchor" ? { ...scan.latest, [line.chain]: line } : scan.latest,
      keyId:
        line.kind === "key"
          ? line.keyId
          : line.kind === "rotation"
            ? line.newKeyId
            : scan.keyId,
    }),
    { prev: GENESIS_PREV_HASH, latest: {}, keyId: null },
  );
};

// ---------------------------------------------------------------------------
// The chain against its anchor
// ---------------------------------------------------------------------------

/** What the database says about the chain where the anchor points. */
export type ChainAtAnchor = Readonly<{
  /** The newest row, or null for an empty table. */
  head: ChainHead | null;
  /** The stored hash of the row at the anchor's `seq`, or null when there is none. */
  hashAtSeq: string | null;
}>;

export type AnchorMatch = "matches" | "truncated" | "removed" | "rewritten";

/**
 * `truncated`: the chain's head is behind the anchor. `removed`: the head is
 * past it but the anchored row is gone. `rewritten`: the anchored row has a
 * different hash, so the chain was rebuilt.
 */
export const compareWithAnchor = (
  anchor: Readonly<{ seq: number; hash: string }>,
  facts: ChainAtAnchor,
): AnchorMatch => {
  if (facts.head === null || facts.head.seq < anchor.seq) return "truncated";
  if (facts.hashAtSeq === null) return "removed";
  return facts.hashAtSeq === anchor.hash ? "matches" : "rewritten";
};

export type AnchorPlan =
  "write" | "unchanged" | "empty" | Exclude<AnchorMatch, "matches">;

/**
 * Whether to write a new anchor for a chain. Only when its head moved on from
 * the latest anchor; never over a chain that is now shorter or different,
 * which would hide exactly what the anchor is there to show.
 */
export const planAnchor = (
  latest: AnchorRecord | undefined,
  facts: ChainAtAnchor,
): AnchorPlan => {
  if (latest === undefined) return facts.head === null ? "empty" : "write";
  const match = compareWithAnchor(latest, facts);
  if (match !== "matches") return match;
  return facts.head !== null && facts.head.seq === latest.seq ? "unchanged" : "write";
};

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

export type DiskKey =
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "unreadable" }>
  | Readonly<{ kind: "found"; keyId: string }>;

export type LogRead =
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "unreadable" }>
  | Readonly<{ kind: "found"; check: AnchorLogCheck }>;

export type AnchorVerdict =
  | Readonly<{ status: "ok"; anchor: AnchorRecord; keyId: string }>
  | Readonly<{
      status: "not-ok";
      reason:
        | LogProblemReason
        | "log-missing"
        | "key-mismatch"
        | Exclude<AnchorMatch, "matches">;
      anchor: AnchorRecord | null;
      line: number | null;
      keyId: string | null;
    }>
  | Readonly<{
      status: "unknown";
      reason:
        | "no-key"
        | "key-unreadable"
        | "log-unreadable"
        | "no-anchor"
        | "chain-unreadable"
        | "continuity-break";
      anchor: AnchorRecord | null;
      line: number | null;
      keyId: string | null;
    }>;

export type VerdictInput = Readonly<{
  chain: ChainName;
  key: DiskKey;
  log: LogRead;
  /** The chain at the latest anchor's `seq` (head only when there is none); null when unreadable. */
  facts: ChainAtAnchor | null;
}>;

/**
 * One chain checked against its latest anchor. Unknown when the check cannot
 * run (no key, a file that cannot be read, no anchor yet) and never OK;
 * Not OK with the reason when something does not hold.
 */
export const anchorVerdict = (input: VerdictInput): AnchorVerdict => {
  const { key, log, facts } = input;
  const keyId = key.kind === "found" ? key.keyId : null;
  const unknown = (
    reason: Extract<AnchorVerdict, { status: "unknown" }>["reason"],
    anchor: AnchorRecord | null = null,
    line: number | null = null,
  ): AnchorVerdict => ({ status: "unknown", reason, anchor, line, keyId });
  const notOk = (
    reason: Extract<AnchorVerdict, { status: "not-ok" }>["reason"],
    anchor: AnchorRecord | null = null,
    line: number | null = null,
  ): AnchorVerdict => ({ status: "not-ok", reason, anchor, line, keyId });

  if (key.kind === "missing") return unknown("no-key");
  if (key.kind === "unreadable") return unknown("key-unreadable");
  if (log.kind === "missing") return notOk("log-missing");
  if (log.kind === "unreadable") return unknown("log-unreadable");
  const { check } = log;
  const anchor = check.state.latest[input.chain] ?? null;
  if (!check.ok) return notOk(check.problem.reason, anchor, check.problem.line);
  if (check.state.key?.keyId !== key.keyId) return notOk("key-mismatch", anchor);
  if (facts === null) return unknown("chain-unreadable", anchor);
  if (anchor === null) return unknown("no-anchor");
  const match = compareWithAnchor(anchor, facts);
  if (match !== "matches") return notOk(match, anchor);
  const lastBreak = check.state.breaks.at(-1);
  if (lastBreak !== undefined) return unknown("continuity-break", anchor, lastBreak);
  return { status: "ok", anchor, keyId: key.keyId };
};

/** How each chain is named in a sentence, and the command that anchors it now. */
export const ANCHOR_CHAIN_WORDS: Readonly<
  Record<ChainName, Readonly<{ name: string; command: string }>>
> = {
  audit: { name: "audit chain", command: "bun run anchor:write" },
  disclosures: { name: "disclosure ledger", command: "bun run anchor:write" },
};

const LOG_PROBLEM_TEXT: Readonly<Record<LogProblemReason, string>> = {
  unreadable: "is not an anchor line",
  "bad-link": "does not point at the line before it, so a line was removed or changed",
  "bad-signature": "has a signature that does not hold",
  "unknown-key": "is signed with a key this machine does not know",
  "no-key-line": "comes before the line that names the first key",
  "second-key-line": "names a first key again",
};

/** One plain sentence for the Lab card and the command line. */
export const anchorSentence = (
  verdict: AnchorVerdict,
  chain: Readonly<{ name: string; command: string }>,
): string => {
  if (verdict.status === "ok") {
    return `The ${chain.name} matches its latest signed anchor (row ${verdict.anchor.seq}).`;
  }
  const seq = verdict.anchor?.seq;
  switch (verdict.reason) {
    case "no-key":
      return `Signed anchors are off: there is no anchor key yet. Create one with \`bun run anchor:init\`.`;
    case "key-unreadable":
      return "The anchor key could not be read.";
    case "log-unreadable":
      return "The anchors file could not be read.";
    case "log-missing":
      return "The anchors file is missing although the anchor key exists, so earlier anchors were removed.";
    case "key-mismatch":
      return "The anchor key on disk is not the key the anchors file ends with.";
    case "chain-unreadable":
      return `The ${chain.name} could not be read to compare with its anchor.`;
    case "no-anchor":
      return `The ${chain.name} has no signed anchor yet. One is written while the server runs, or now with \`${chain.command}\`.`;
    case "truncated":
      return `The ${chain.name} is shorter than its latest signed anchor (row ${seq}), so rows were removed from its end.`;
    case "removed":
      return `Row ${seq}, which the latest signed anchor names, is missing from the ${chain.name}.`;
    case "rewritten":
      return `Row ${seq} of the ${chain.name} has a different hash from its signed anchor, so the chain was rebuilt.`;
    case "continuity-break":
      return `The anchor key was replaced without the old key at line ${verdict.line}, so anchors before that line cannot be tied to this key.`;
    default:
      return `Line ${verdict.line} of the anchors file ${LOG_PROBLEM_TEXT[verdict.reason]}.`;
  }
};
