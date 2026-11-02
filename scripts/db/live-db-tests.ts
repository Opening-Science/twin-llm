/**
 * The RUN_LIVE=1 tests that need only a migrated Postgres: no network, no
 * model, no secrets (#430). CI runs them in the prisma job after db:verify.
 * Every other RUN_LIVE test is listed in EXCLUDED_LIVE_TESTS with the reason.
 *
 * A run passes only when exactly EXPECTED_LIVE_DB_TESTS tests pass and none is
 * skipped or failed, so a test that quietly skips (RUN_LIVE not set, a file
 * renamed, a describe.skipIf that turns true) fails the run.
 */

export type LiveDbTest = { readonly file: string; readonly tests: number };

export const LIVE_DB_TESTS: readonly LiveDbTest[] = [
  { file: "features/data-explorer/cohort-queries.live.test.ts", tests: 7 },
  { file: "packages/gbd-local/store.live.test.ts", tests: 6 },
  { file: "features/gbd/gbd-import-routes.live.test.ts", tests: 2 },
  { file: "scripts/gbd/import.live.test.ts", tests: 2 },
];

export const EXPECTED_LIVE_DB_TESTS = LIVE_DB_TESTS.reduce(
  (sum, entry) => sum + entry.tests,
  0,
);

/** RUN_LIVE tests left out of test:live-db, and why. */
export const EXCLUDED_LIVE_TESTS: Readonly<Record<string, string>> = {
  "packages/gbd-mcp/live.test.ts":
    "calls the hosted GBD MCP server; needs network and GBD_MCP_TOKEN",
  "packages/vitronic/live.test.ts": "calls a BodyLoop server; never CI",
  "features/chat/tool-calls.live.test.ts":
    "needs a model (Ollama or a remote GPU) and a seeded warehouse",
  "tests/knowledge/search-db.live.test.ts":
    "needs Ollama embeddings and both corpora ingested",
  "tests/knowledge/retrieval.test.ts": "needs Ollama embeddings",
  "scripts/synthea/reproducible.live.test.ts":
    "needs Java 21+, the Synthea JAR and a few minutes",
  "evaluation/answer-key.test.ts": "needs .env.eval and the evaluation cohort",
  "evaluation/answer-key.s7.test.ts": "needs the cohort files (EVAL_COHORT_DIR)",
  "evaluation/answer-key.s7b.test.ts": "needs the cohort files (S7_COHORT_DIR)",
  "evaluation/answer-key.s7h.test.ts": "needs the cohort files (S7_COHORT_DIR)",
  "evaluation/answer-key.v1h.test.ts": "needs the cohort files (V1H_COHORT_DIR)",
  "tests/guardrails/runner.test.ts":
    "a local hook that checks RUN_LIVE is unset in plain bun test; no database",
};

export type BunTestSummary = {
  readonly pass: number;
  readonly fail: number;
  readonly skip: number;
  readonly todo: number;
};

/** Reads the " 17 pass", " 0 fail", " 2 skip" lines of `bun test` output. */
export const parseBunTestSummary = (output: string): BunTestSummary => {
  const count = (word: string): number => {
    const match = output.match(new RegExp(`^\\s*(\\d+) ${word}\\s*$`, "m"));
    return match ? Number(match[1]) : 0;
  };
  return {
    pass: count("pass"),
    fail: count("fail"),
    skip: count("skip"),
    todo: count("todo"),
  };
};

/** Problems with a run, or an empty list when it is the expected one. */
export const checkLiveDbRun = (
  summary: BunTestSummary,
  exitCode: number,
  expected: number,
): readonly string[] => [
  ...(exitCode === 0 ? [] : [`bun test exited with ${exitCode}`]),
  ...(summary.fail === 0 ? [] : [`${summary.fail} failed`]),
  ...(summary.skip === 0 ? [] : [`${summary.skip} skipped`]),
  ...(summary.todo === 0 ? [] : [`${summary.todo} todo`]),
  ...(summary.pass === expected ? [] : [`${summary.pass} passed, expected ${expected}`]),
];

/** Test files that read RUN_LIVE but are in neither list. */
export const unlistedLiveTests = (
  filesReadingRunLive: readonly string[],
): readonly string[] => {
  const listed = new Set([
    ...LIVE_DB_TESTS.map((entry) => entry.file),
    ...Object.keys(EXCLUDED_LIVE_TESTS),
  ]);
  return filesReadingRunLive.filter((file) => !listed.has(file));
};
