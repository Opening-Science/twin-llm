import { describe, expect, test } from "bun:test";

import {
  type GbdImportProgress,
  type GbdImportStore,
  importGbdChunks,
  sha256Of,
} from "./import-chunks";
import { MADE_UP_CAUSE_CSV, MADE_UP_HEADER } from "./made-up-results.test-helpers";
import { GBD_STORE_BATCH } from "./store-types";

/** The chunked import with a store in memory; the CSV is MADE UP. */

const memoryStore = (known: readonly string[] = [], failOnAdd = false) => {
  const calls: string[] = [];
  const keys = new Set<string>();
  const store: GbdImportStore = {
    known: async (sha256) => known.includes(sha256),
    begin: async (file) => {
      calls.push(`begin ${file.fileName} ${file.citation ?? "-"}`);
    },
    addRows: async (_sha256, rows) => {
      if (failOnAdd) throw new Error("write failed");
      calls.push(`add ${rows.length}`);
      const fresh = rows.filter(
        (row) => !keys.has(`${row.year}:${row.locationId}:${row.val}`),
      );
      rows.forEach((row) => keys.add(`${row.year}:${row.locationId}:${row.val}`));
      return fresh.length;
    },
    finish: async (_sha256, counts) => {
      calls.push(`finish ${counts.rowCount} ${counts.newRows}`);
    },
    abort: async () => {
      calls.push("abort");
    },
  };
  return { store, calls };
};

const bytes = (text: string) => new TextEncoder().encode(text);

const chunked = (data: Uint8Array, size: number): Uint8Array[] =>
  Array.from({ length: Math.ceil(data.length / size) }, (_, index) =>
    data.subarray(index * size, (index + 1) * size),
  );

const FILE = { sha256: "a".repeat(64), fileName: "IHME-GBD_2023_DATA-1.csv" };

describe("importGbdChunks (#426)", () => {
  test("sha256Of is the hex SHA-256 of the bytes", () => {
    expect(sha256Of(bytes("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  test("reads chunks, writes the rows and records the counts and citation", async () => {
    const { store, calls } = memoryStore();
    const progress: GbdImportProgress[] = [];
    const data = bytes(MADE_UP_CAUSE_CSV);
    const outcome = await importGbdChunks(
      { ...FILE, citation: "A made-up citation." },
      chunked(data, 100),
      store,
      (step) => void progress.push(step),
    );
    expect(outcome).toEqual({
      kind: "imported",
      sha256: FILE.sha256,
      rowCount: 12,
      newRows: 12,
    });
    expect(calls).toEqual([
      "begin IHME-GBD_2023_DATA-1.csv A made-up citation.",
      "add 12",
      "finish 12 12",
    ]);
    expect(progress.at(-1)).toEqual({ bytes: data.length, rows: 12 });
  });

  test("a multibyte character split between chunks is read whole", async () => {
    const { store } = memoryStore();
    const text = `${MADE_UP_HEADER}\n1,Deaths,94,Zürich,3,Both,27,All,491,CVD,3,Rate,2021,1,2,0\n`;
    const rows: string[] = [];
    const capture: GbdImportStore = {
      ...store,
      addRows: async (_sha, batch) => {
        rows.push(...batch.map((row) => row.locationName));
        return batch.length;
      },
    };
    await importGbdChunks(FILE, chunked(bytes(text), 3), capture);
    expect(rows).toEqual(["Zürich"]);
  });

  test("writes a large file in batches as it reads", async () => {
    const line = (year: number) =>
      `1,Deaths,94,Switzerland,3,Both,27,All,491,CVD,3,Rate,${year},1,2,0\n`;
    const count = GBD_STORE_BATCH + 10;
    const lines = [
      `${MADE_UP_HEADER}\n`,
      ...Array.from({ length: count }, (_, i) => line(i)),
    ];
    const { store, calls } = memoryStore();
    await importGbdChunks(FILE, lines.map(bytes), store);
    expect(calls).toEqual([
      "begin IHME-GBD_2023_DATA-1.csv -",
      `add ${GBD_STORE_BATCH}`,
      "add 10",
      `finish ${count} ${count}`,
    ]);
  });

  test("a known checksum is skipped before anything is read", async () => {
    const { store, calls } = memoryStore([FILE.sha256]);
    const read: number[] = [];
    const chunks = (function* () {
      read.push(1);
      yield bytes(MADE_UP_CAUSE_CSV);
    })();
    expect(await importGbdChunks(FILE, chunks, store)).toEqual({
      kind: "already-imported",
      sha256: FILE.sha256,
    });
    expect([calls, read]).toEqual([[], []]);
  });

  test("a file that is not an export is refused without a write", async () => {
    const { store, calls } = memoryStore();
    const outcome = await importGbdChunks(FILE, [bytes("a,b\n1,2\n")], store);
    expect(outcome.kind === "refused" ? outcome.error.code : null).toBe(
      "GBD_CSV_COLUMNS",
    );
    expect(calls).toEqual([]);
  });

  test("a bad row after a written batch drops the file's record", async () => {
    const line = (year: number) =>
      `1,Deaths,94,Switzerland,3,Both,27,All,491,CVD,3,Rate,${year},1,2,0`;
    const text = [
      MADE_UP_HEADER,
      ...Array.from({ length: GBD_STORE_BATCH }, (_, i) => line(i)),
      "1,Deaths,94,Switzerland,3,Both,27,All,491,CVD,3,Rate,2021,x,2,0",
    ].join("\n");
    const { store, calls } = memoryStore();
    const outcome = await importGbdChunks(FILE, chunked(bytes(text), 65536), store);
    expect(
      outcome.kind === "refused" ? [outcome.error.code, outcome.error.line] : null,
    ).toEqual(["GBD_CSV_ROW", GBD_STORE_BATCH + 2]);
    expect(calls.at(-1)).toBe("abort");
    expect(calls.some((call) => call.startsWith("finish"))).toBe(false);
  });

  test("a failed write drops the file's record and is thrown", async () => {
    const { store, calls } = memoryStore([], true);
    await expect(
      importGbdChunks(FILE, [bytes(MADE_UP_CAUSE_CSV)], store),
    ).rejects.toThrow("write failed");
    expect(calls).toEqual(["begin IHME-GBD_2023_DATA-1.csv -", "abort"]);
  });

  test("a header-only file is recorded with no rows", async () => {
    const { store, calls } = memoryStore();
    expect(await importGbdChunks(FILE, [bytes(`${MADE_UP_HEADER}\n`)], store)).toEqual({
      kind: "imported",
      sha256: FILE.sha256,
      rowCount: 0,
      newRows: 0,
    });
    expect(calls).toEqual(["begin IHME-GBD_2023_DATA-1.csv -", "finish 0 0"]);
  });
});
