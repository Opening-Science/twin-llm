import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import {
  clearGbdStore,
  liveDatabase,
  OVERLAP_FILE_A,
  OVERLAP_FILE_B,
  requireEmptyGbdStore,
  runLive,
  storedEstimates,
} from "../../packages/gbd-local/made-up-overlap.test-helpers";
import { deleteGbdImport, gbdImportStore } from "../../packages/gbd-local/store";

import { type GbdImportDeps, runGbdImport, sha256Of } from "./import";

/**
 * `bun run gbd:import` against a real Postgres (#428): overlapping MADE-UP
 * files, a delete, and the deleted file imported again from the CLI.
 *   RUN_LIVE=1 DATABASE_URL=<throwaway, migrated> bun test scripts/gbd/import.live.test.ts
 */

const FILES: Readonly<Record<string, string>> = {
  "/downloads/a.csv": OVERLAP_FILE_A,
  "/downloads/b.csv": OVERLAP_FILE_B,
};
const SHA_A = sha256Of(Buffer.from(OVERLAP_FILE_A, "utf8"));
const SHA_B = sha256Of(Buffer.from(OVERLAP_FILE_B, "utf8"));

describe.skipIf(!runLive)("bun run gbd:import with shared estimates (RUN_LIVE=1)", () => {
  const db = liveDatabase();
  const out: string[] = [];
  const deps: GbdImportDeps = {
    readFile: async (path) => {
      const text = FILES[path];
      if (text === undefined) throw new Error("missing");
      return Buffer.from(text, "utf8");
    },
    store: gbdImportStore(db),
    stdout: { write: (chunk) => void out.push(chunk) },
    stderr: { write: (chunk) => void out.push(chunk) },
  };

  beforeAll(() => requireEmptyGbdStore(db));
  afterEach(async () => {
    out.splice(0);
    await clearGbdStore(db);
  });
  afterAll(() => db.$disconnect());

  test("imports both files, then a delete in either order keeps the shared estimate", async () => {
    expect(await runGbdImport(["/downloads/a.csv", "/downloads/b.csv"], deps)).toBe(0);
    expect(out).toEqual([
      `a.csv sha256 ${SHA_A}: 2 rows, 2 new\n`,
      `b.csv sha256 ${SHA_B}: 2 rows, 1 new\n`,
    ]);
    expect(await deleteGbdImport(db, SHA_B)).toBe(1);
    expect(await storedEstimates(db)).toEqual(["Switzerland 2021", "Switzerland 2023"]);
  });

  test("a deleted file imported again from the CLI is linked again", async () => {
    await runGbdImport(["/downloads/a.csv", "/downloads/b.csv"], deps);
    expect(await deleteGbdImport(db, SHA_A)).toBe(1);
    out.splice(0);
    expect(await runGbdImport(["/downloads/a.csv", "/downloads/b.csv"], deps)).toBe(0);
    expect(out).toEqual([
      `a.csv sha256 ${SHA_A}: 2 rows, 1 new\n`,
      `b.csv sha256 ${SHA_B}: already imported, skipped\n`,
    ]);
    expect(await deleteGbdImport(db, SHA_B)).toBe(1);
    expect(await storedEstimates(db)).toEqual(["Switzerland 2021", "Switzerland 2023"]);
  });
});
