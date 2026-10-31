import type { VerifyChainResult } from "./chain";

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

export const CHAINS = ["audit", "disclosures"] as const;

export type ChainName = (typeof CHAINS)[number];

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
