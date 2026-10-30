import type { VerifyChainResult } from "./verify-chain";

/**
 * The pure half of `verify-cli.ts`: which mode the flags ask for, and what
 * `--check` prints and exits with. The exit codes match the Lab page's
 * Audit chain card: 0 for OK, 1 for a broken chain (Not OK), 2 for an empty
 * table (Unknown), and 64 for flags that do not make sense together.
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

export type CheckOutcome = Readonly<{
  code: (typeof EXIT)[keyof typeof EXIT];
  stream: "stdout" | "stderr";
  line: string;
}>;

export const checkOutcome = (result: VerifyChainResult): CheckOutcome => {
  const latest = result.latestHash ?? "none";
  if (!result.ok) {
    return {
      code: EXIT.broken,
      stream: "stderr",
      line: `verify-audit FAIL: ${result.checked} of ${result.total} rows checked, broken at seq ${result.brokenAtSeq}, latest hash ${latest}`,
    };
  }
  if (result.total === 0) {
    return {
      code: EXIT.unknown,
      stream: "stderr",
      line: "verify-audit UNKNOWN: the audit table has no rows, so there is no chain to check",
    };
  }
  return {
    code: EXIT.ok,
    stream: "stdout",
    line: `verify-audit OK: ${result.total} rows checked, latest hash ${latest}`,
  };
};
