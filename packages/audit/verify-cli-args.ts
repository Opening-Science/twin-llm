import { ANCHOR_CHAIN_WORDS, type AnchorVerdict, anchorSentence } from "./anchor";
import { CHAINS, type ChainName, type VerifyChainResult } from "./chain";

/**
 * The pure half of `verify-cli.ts`: which mode and chain the flags ask for,
 * and what `--check` prints and exits with. The exit codes match the Lab
 * page's Audit chain and Disclosure ledger cards: 0 for OK, 1 for a broken
 * chain (Not OK), 2 for an empty table (Unknown), and 64 for flags that do
 * not make sense together. `--chain disclosures` checks the disclosure
 * ledger (#140); the default is the audit log.
 */

export const VERIFY_MODES = ["--check", "--seed-ok", "--expect-broken"] as const;

export type VerifyMode = (typeof VERIFY_MODES)[number];

export const EXIT = { ok: 0, broken: 1, unknown: 2, usage: 64 } as const;

export const parseVerifyMode = (
  argv: readonly string[],
): Readonly<{ mode: VerifyMode }> | Readonly<{ error: string }> => {
  const modes = VERIFY_MODES.filter((mode) => argv.includes(mode));
  if (modes.length === 1) return { mode: modes[0] };
  return modes.length === 0
    ? { error: "verify-cli: pass --check, --seed-ok or --expect-broken" }
    : { error: `verify-cli: pass only one of ${modes.join(", ")}` };
};

export { CHAINS, type ChainName };

/** `--chain <name>`, or the audit log when absent. Seeding is for the audit log only. */
export const parseChain = (
  argv: readonly string[],
  mode: VerifyMode,
): Readonly<{ chain: ChainName }> | Readonly<{ error: string }> => {
  const at = argv.indexOf("--chain");
  if (at === -1) return { chain: "audit" };
  const value = argv[at + 1];
  const chain = CHAINS.find((name) => name === value);
  if (chain === undefined) {
    return { error: "verify-cli: --chain takes audit or disclosures" };
  }
  if (chain !== "audit" && mode !== "--check") {
    return { error: `verify-cli: ${mode} works on the audit chain only` };
  }
  return { chain };
};

const NAMES: Readonly<Record<ChainName, Readonly<{ tag: string; table: string }>>> = {
  audit: { tag: "verify-audit", table: "the audit table" },
  disclosures: { tag: "verify-disclosures", table: "the disclosure ledger" },
};

export type CheckOutcome = Readonly<{
  code: (typeof EXIT)[keyof typeof EXIT];
  stream: "stdout" | "stderr";
  line: string;
}>;

export const checkOutcome = (
  result: VerifyChainResult,
  chain: ChainName = "audit",
): CheckOutcome => {
  const latest = result.latestHash ?? "none";
  const { tag, table } = NAMES[chain];
  if (!result.ok) {
    return {
      code: EXIT.broken,
      stream: "stderr",
      line: `${tag} FAIL: ${result.checked} of ${result.total} rows checked, broken at seq ${result.brokenAtSeq}, latest hash ${latest}`,
    };
  }
  if (result.total === 0) {
    return {
      code: EXIT.unknown,
      stream: "stderr",
      line: `${tag} UNKNOWN: ${table} has no rows, so there is no chain to check`,
    };
  }
  return {
    code: EXIT.ok,
    stream: "stdout",
    line: `${tag} OK: ${result.total} rows checked, latest hash ${latest}`,
  };
};

// ---------------------------------------------------------------------------
// Signed anchors (#300)
// ---------------------------------------------------------------------------

export type AnchorOption =
  | Readonly<{ anchors: "default" }>
  | Readonly<{ anchors: "off" }>
  | Readonly<{ anchors: "file"; path: string }>;

/**
 * `--check` compares the chain with its latest signed anchor in the state
 * folder by default; `--anchors <file>` reads another anchors file (its keys
 * next to it) and `--no-anchors` checks the chain alone, as before #300.
 */
export const parseAnchorOption = (
  argv: readonly string[],
  mode: VerifyMode,
): AnchorOption | Readonly<{ error: string }> => {
  const off = argv.includes("--no-anchors");
  const at = argv.indexOf("--anchors");
  if (!off && at === -1) return { anchors: mode === "--check" ? "default" : "off" };
  if (mode !== "--check") {
    return { error: "verify-cli: --anchors and --no-anchors go with --check only" };
  }
  if (off && at !== -1) {
    return { error: "verify-cli: pass only one of --anchors, --no-anchors" };
  }
  if (off) return { anchors: "off" };
  const path = argv[at + 1];
  return path === undefined || path.startsWith("--")
    ? { error: "verify-cli: --anchors takes the path of an anchors file" }
    : { anchors: "file", path };
};

const ANCHOR_STATUS = {
  ok: { code: EXIT.ok, stream: "stdout", word: "OK" },
  "not-ok": { code: EXIT.broken, stream: "stderr", word: "FAIL" },
  unknown: { code: EXIT.unknown, stream: "stderr", word: "UNKNOWN" },
} as const;

/** What `--check` prints about the anchor, and its exit code. */
export const anchorOutcome = (
  verdict: AnchorVerdict,
  chain: ChainName = "audit",
): CheckOutcome => {
  const { code, stream, word } = ANCHOR_STATUS[verdict.status];
  const where =
    verdict.anchor === null
      ? ""
      : ` Latest anchor: row ${verdict.anchor.seq} at ${verdict.anchor.at}.`;
  const key = verdict.keyId === null ? "" : ` Key ${verdict.keyId.slice(0, 16)}.`;
  return {
    code,
    stream,
    line: `${NAMES[chain].tag} anchor ${word}: ${anchorSentence(verdict, ANCHOR_CHAIN_WORDS[chain])}${where}${key}`,
  };
};

/** Not OK wins over Unknown, which wins over OK. */
export const worstExit = (
  ...codes: readonly CheckOutcome["code"][]
): CheckOutcome["code"] =>
  codes.includes(EXIT.broken)
    ? EXIT.broken
    : codes.includes(EXIT.unknown)
      ? EXIT.unknown
      : EXIT.ok;
