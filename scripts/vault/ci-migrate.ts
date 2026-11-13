/**
 * `bun run vault:ci-migrate` (CI job `vault-migrate`, docs/privacy-design.md 4):
 * runs `vault:migrate` end to end on a throwaway, migrated database with
 * synthetic rows only.
 *
 *   1. Seeds the made-up personal-import fixtures, written plain (ci-db.ts seed).
 *   2. Runs `vault:migrate --backup-confirmed` in personal mode with a
 *      passphrase made here, held in memory and given on stdin only: never
 *      in an argument, the environment, a file or the log. The recovery code
 *      it shows is hidden in the log.
 *   3. Checks that no plain value is left and no row was lost.
 *   4. Runs it again with the same passphrase and checks that it sealed
 *      nothing and every table is stored exactly as before.
 *
 * Needs DATABASE_URL, TWINLLM_STATE_DIR and VITRONIC_DATA_DIR (new folders).
 * Prints table names and counts only.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  type DatabaseState,
  doneCounts,
  migrateInput,
  newRunPassphrase,
  redactLine,
  sealedProblems,
  seededProblems,
  stateLines,
  unchangedProblems,
} from "./ci-migrate-checks";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PRELOAD = "./features/chat/response/preload-server-only.mjs";

type Run = Readonly<{ code: number; output: string }>;

/** Runs one bun step with DATA_MODE set; prints its output line by line, redacted. */
const run = (
  args: readonly string[],
  dataMode: "synthetic" | "personal",
  input: string,
  echo: boolean,
): Promise<Run> =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, ["--preload", PRELOAD, ...args], {
      cwd: ROOT,
      env: { ...process.env, DATA_MODE: dataMode },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines: string[] = [];
    let pending = "";
    const take = (chunk: Buffer) => {
      pending += chunk.toString("utf8");
      const parts = pending.split("\n");
      pending = parts.pop() ?? "";
      for (const line of parts) {
        const shown = redactLine(line);
        lines.push(shown);
        if (echo) console.log(shown);
      }
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.stdin.end(input);
    child.on("close", (code) => {
      if (pending !== "") {
        const shown = redactLine(pending);
        lines.push(shown);
        if (echo) console.log(shown);
      }
      resolve({ code: code ?? 1, output: lines.join("\n") });
    });
  });

const fail = (step: string, problems: readonly string[]): never => {
  console.error(`vault:ci-migrate FAIL at ${step}: ${problems.join("; ")}`);
  process.exit(1);
};

const readState = async (step: string): Promise<DatabaseState> => {
  const result = await run(["scripts/vault/ci-db.ts", "state"], "personal", "", false);
  const json = result.output.split("\n").find((line) => line.startsWith("{"));
  if (result.code !== 0 || json === undefined) return fail(step, [result.output]);
  const state = JSON.parse(json) as DatabaseState;
  console.log(`${step}:`);
  for (const line of stateLines(state)) console.log(line);
  return state;
};

const migrate = async (
  step: string,
  passphrase: string,
  setup: boolean,
): Promise<Readonly<{ rows: number; meshFiles: number }>> => {
  console.log(`=== ${step} ===`);
  const result = await run(
    ["scripts/vault/migrate.ts", "--backup-confirmed"],
    "personal",
    migrateInput(setup ? "setup" : "unlock", passphrase),
    true,
  );
  const done = doneCounts(result.output);
  if (result.code !== 0 || done === null) {
    return fail(step, [`vault:migrate exited ${result.code} without its Done line`]);
  }
  return done;
};

console.log("=== seed (plain, as before #141) ===");
const seeded = await run(["scripts/vault/ci-db.ts", "seed"], "synthetic", "", true);
if (seeded.code !== 0) fail("seed", ["seeding failed"]);
const before = await readState("before");
const seedProblems = seededProblems(before);
if (seedProblems.length > 0) fail("seed", seedProblems);

const passphrase = newRunPassphrase();

const first = await migrate("vault:migrate, first run", passphrase, true);
if (first.rows === 0) fail("first run", ["it sealed no row"]);
const afterFirst = await readState("after the first run");
const firstProblems = sealedProblems(before, afterFirst);
if (firstProblems.length > 0) fail("first run", firstProblems);

const second = await migrate("vault:migrate, second run", passphrase, false);
if (second.rows !== 0 || second.meshFiles !== 0) {
  fail("second run", [
    `it sealed ${second.rows} row(s) and ${second.meshFiles} mesh file(s)`,
  ]);
}
const afterSecond = await readState("after the second run");
const secondProblems = [
  ...sealedProblems(before, afterSecond),
  ...unchangedProblems(afterFirst, afterSecond),
];
if (secondProblems.length > 0) fail("second run", secondProblems);

const sealed = Object.values(afterSecond).reduce((total, table) => total + table.rows, 0);
console.log(
  `vault:ci-migrate OK: ${first.rows} row(s) sealed, 0 plain left over ${sealed} row(s); the second run changed nothing`,
);
process.exit(0);
