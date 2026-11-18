import { randomBytes } from "node:crypto";

/**
 * Pure parts of `bun run vault:ci-migrate` (docs/privacy-design.md 4): the
 * passphrase made for one run, what `vault:migrate` reads on stdin, the
 * recovery code kept out of the log, and the checks between the steps.
 * Tested without a terminal or a database.
 */

/** Per table: rows, plain values left, and a digest of every row as stored. */
export type TableState = Readonly<{ rows: number; plain: number; digest: string }>;
export type DatabaseState = Readonly<Record<string, TableState>>;

/** 32 random bytes as base64url: 43 characters, inside the passphrase rules. */
export const newRunPassphrase = (): string => randomBytes(32).toString("base64url");

/**
 * Lines for `vault:migrate` with `--backup-confirmed`: a first run sets the
 * passphrase up (typed twice, then "saved" for the recovery code); a later
 * run unlocks with it.
 */
export const migrateInput = (step: "setup" | "unlock", passphrase: string): string =>
  step === "setup" ? `${passphrase}\n${passphrase}\nsaved\n` : `${passphrase}\n`;

const RECOVERY_LINE = /^(Recovery code \(shown once\): ).*$/;

/** One output line as the CI log may show it: the recovery code is hidden. */
export const redactLine = (line: string): string =>
  line.replace(RECOVERY_LINE, "$1[hidden]");

/** `Done: 12 row(s) and 0 mesh file(s) sealed.` as counts; null when absent. */
export const doneCounts = (
  output: string,
): Readonly<{ rows: number; meshFiles: number }> | null => {
  const match = /^Done: (\d+) row\(s\) and (\d+) mesh file\(s\) sealed\.$/m.exec(output);
  return match === null ? null : { rows: Number(match[1]), meshFiles: Number(match[2]) };
};

const sum = (state: DatabaseState, field: "rows" | "plain"): number =>
  Object.values(state).reduce((total, table) => total + table[field], 0);

/** Before the migration: the fixtures are in, and stored as plain text. */
export const seededProblems = (state: DatabaseState): readonly string[] => {
  const problems: string[] = [];
  if ((state.personal_datasets?.rows ?? 0) === 0) problems.push("no dataset was seeded");
  if ((state.personal_observations?.plain ?? 0) === 0)
    problems.push("no plain observation to seal");
  if (sum(state, "plain") === 0) problems.push("no plain value to seal");
  return problems;
};

/** After a migration: no plain value left, and no row lost. */
export const sealedProblems = (
  before: DatabaseState,
  after: DatabaseState,
): readonly string[] => [
  ...Object.entries(after)
    .filter(([, table]) => table.plain > 0)
    .map(([name, table]) => `${name}: ${table.plain} plain value(s) left`),
  ...Object.entries(before)
    .filter(
      ([name, table]) =>
        name !== "thread_search_embeddings" && (after[name]?.rows ?? 0) !== table.rows,
    )
    .map(
      ([name, table]) =>
        `${name}: ${table.rows} row(s) before, ${after[name]?.rows ?? 0} after`,
    ),
];

/** A second run: every table stored exactly as after the first. */
export const unchangedProblems = (
  first: DatabaseState,
  second: DatabaseState,
): readonly string[] =>
  [...new Set([...Object.keys(first), ...Object.keys(second)])]
    .filter((name) => first[name]?.digest !== second[name]?.digest)
    .map((name) => `${name} changed on the second run`);

/** Table names with their row and plain counts, for the log; never a value. */
export const stateLines = (state: DatabaseState): readonly string[] =>
  Object.entries(state)
    .filter(([, table]) => table.rows > 0)
    .map(([name, table]) => `  ${name}: ${table.rows} row(s), ${table.plain} plain`);
