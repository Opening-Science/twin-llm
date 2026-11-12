import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { importGbdChunks, sha256Of } from "./import-chunks";
import {
  clearGbdStore,
  liveDatabase,
  OVERLAP_FILE_A,
  OVERLAP_FILE_B,
  PROBE_YEAR_FILE,
  requireEmptyGbdStore,
  runLive,
  storedEstimates,
} from "./made-up-overlap.test-helpers";
import { deleteGbdImport, gbdImportStore, gbdProbeRows, listGbdImports } from "./store";

/**
 * The GBD store against a real Postgres (#428): two overlapping MADE-UP
 * files, deletes in both orders, a re-import after a delete and an abort.
 *   RUN_LIVE=1 DATABASE_URL=<throwaway, migrated> bun test packages/gbd-local/store.live.test.ts
 */

const bytes = (text: string) => new TextEncoder().encode(text);
const SHA_A = sha256Of(bytes(OVERLAP_FILE_A));
const SHA_B = sha256Of(bytes(OVERLAP_FILE_B));

describe.skipIf(!runLive)("GBD store with shared estimates (RUN_LIVE=1)", () => {
  const db = liveDatabase();
  const store = gbdImportStore(db);
  const load = (text: string, fileName: string) =>
    importGbdChunks({ sha256: sha256Of(bytes(text)), fileName }, [bytes(text)], store);
  const held = async () =>
    (await listGbdImports(db)).map((view) => [view.fileName, view.storedRows] as const);

  beforeAll(() => requireEmptyGbdStore(db));
  afterEach(() => clearGbdStore(db));
  afterAll(() => db.$disconnect());

  test("the second file links the shared estimate and counts only its new one", async () => {
    expect(await load(OVERLAP_FILE_A, "a.csv")).toEqual({
      kind: "imported",
      sha256: SHA_A,
      rowCount: 2,
      newRows: 2,
    });
    expect(await load(OVERLAP_FILE_B, "b.csv")).toEqual({
      kind: "imported",
      sha256: SHA_B,
      rowCount: 2,
      newRows: 1,
    });
    expect(await storedEstimates(db)).toEqual([
      "Germany 2023",
      "Switzerland 2021",
      "Switzerland 2023",
    ]);
    expect(await held()).toEqual([
      ["b.csv", 2],
      ["a.csv", 2],
    ]);
  });

  test("deleting the first file keeps the estimate the second also has", async () => {
    await load(OVERLAP_FILE_A, "a.csv");
    await load(OVERLAP_FILE_B, "b.csv");
    expect(await deleteGbdImport(db, SHA_A)).toBe(1);
    expect(await storedEstimates(db)).toEqual(["Germany 2023", "Switzerland 2023"]);
    expect(await deleteGbdImport(db, SHA_B)).toBe(2);
    expect(await storedEstimates(db)).toEqual([]);
    expect(await db.gbdEstimateFile.count()).toBe(0);
  });

  test("deleting the second file first keeps the first file's estimates", async () => {
    await load(OVERLAP_FILE_A, "a.csv");
    await load(OVERLAP_FILE_B, "b.csv");
    expect(await deleteGbdImport(db, SHA_B)).toBe(1);
    expect(await storedEstimates(db)).toEqual(["Switzerland 2021", "Switzerland 2023"]);
    expect(await held()).toEqual([["a.csv", 2]]);
    expect(await deleteGbdImport(db, SHA_A)).toBe(2);
    expect(await storedEstimates(db)).toEqual([]);
  });

  test("an unknown file deletes nothing", async () => {
    await load(OVERLAP_FILE_A, "a.csv");
    expect(await deleteGbdImport(db, "f".repeat(64))).toBeNull();
    expect(await storedEstimates(db)).toEqual(["Switzerland 2021", "Switzerland 2023"]);
  });

  test("a deleted file imported again gets all its links back", async () => {
    await load(OVERLAP_FILE_A, "a.csv");
    await load(OVERLAP_FILE_B, "b.csv");
    await deleteGbdImport(db, SHA_A);
    expect(await load(OVERLAP_FILE_A, "a.csv")).toEqual({
      kind: "imported",
      sha256: SHA_A,
      rowCount: 2,
      newRows: 1,
    });
    expect((await held()).sort()).toEqual([
      ["a.csv", 2],
      ["b.csv", 2],
    ]);
    // B goes, and A still has both of its estimates.
    expect(await deleteGbdImport(db, SHA_B)).toBe(1);
    expect(await storedEstimates(db)).toEqual(["Switzerland 2021", "Switzerland 2023"]);
  });

  test("a failed import is undone and keeps what another file has", async () => {
    await load(OVERLAP_FILE_A, "a.csv");
    const failing = {
      ...store,
      finish: async () => {
        throw new Error("finish failed");
      },
    };
    await expect(
      importGbdChunks(
        { sha256: SHA_B, fileName: "b.csv" },
        [bytes(OVERLAP_FILE_B)],
        failing,
      ),
    ).rejects.toThrow("finish failed");
    expect(await storedEstimates(db)).toEqual(["Switzerland 2021", "Switzerland 2023"]);
    expect(await held()).toEqual([["a.csv", 2]]);
  });

  test("the S4 probe check sees one Germany row and one 2015 row (#273)", async () => {
    await load(OVERLAP_FILE_A, "a.csv");
    expect(await gbdProbeRows(db)).toEqual({ germany: false, year2015: false });
    await load(OVERLAP_FILE_B, "b.csv");
    expect(await gbdProbeRows(db)).toEqual({ germany: true, year2015: false });
    await clearGbdStore(db);
    await load(PROBE_YEAR_FILE, "2015.csv");
    expect(await gbdProbeRows(db)).toEqual({ germany: false, year2015: true });
  });
});
