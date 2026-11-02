/**
 * `bun run test:live-db`: the database live tests against DATABASE_URL, a
 * throwaway, migrated Postgres (#430). Fails unless every one of them passes;
 * a skipped test counts as a failure.
 *   DATABASE_URL=<throwaway, migrated> bun run test:live-db
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  checkLiveDbRun,
  EXPECTED_LIVE_DB_TESTS,
  LIVE_DB_TESTS,
  parseBunTestSummary,
} from "./live-db-tests";

if (!process.env.DATABASE_URL) {
  console.error(
    "test:live-db FAIL: DATABASE_URL is required (a throwaway, migrated database)",
  );
  process.exit(1);
}

const child = spawn(
  process.execPath,
  [
    "test",
    "--preload",
    "./features/chat/response/preload-server-only.mjs",
    ...LIVE_DB_TESTS.map((entry) => `./${entry.file}`),
  ],
  {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    env: { ...process.env, RUN_LIVE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

const output: string[] = [];
child.stdout.on("data", (chunk: Buffer) => {
  process.stdout.write(chunk);
  output.push(chunk.toString("utf8"));
});
child.stderr.on("data", (chunk: Buffer) => {
  process.stderr.write(chunk);
  output.push(chunk.toString("utf8"));
});

const exitCode = await new Promise<number>((resolve) => {
  child.on("close", (code) => resolve(code ?? 1));
});

const problems = checkLiveDbRun(
  parseBunTestSummary(output.join("")),
  exitCode,
  EXPECTED_LIVE_DB_TESTS,
);
if (problems.length > 0) {
  console.error(`test:live-db FAIL: ${problems.join("; ")}`);
  process.exit(1);
}
console.log(`test:live-db OK: ${EXPECTED_LIVE_DB_TESTS} pass, 0 skip, 0 fail`);
