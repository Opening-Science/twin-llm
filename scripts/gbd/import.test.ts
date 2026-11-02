import { describe, expect, test } from "bun:test";

import { MADE_UP_CAUSE_CSV } from "../../packages/gbd-local/made-up-results.test-helpers";
import type { GbdFileImport, GbdImportOutcome } from "../../packages/gbd-local/store";

import { type GbdImportDeps, runGbdImport, sha256Of } from "./import";

/** The CLI with fakes; the CSV is MADE UP in the Results Tool layout. */

const fakes = (
  files: Readonly<Record<string, string>>,
  known: readonly string[] = [],
) => {
  const out: string[] = [];
  const err: string[] = [];
  const stored: GbdFileImport[] = [];
  const deps: GbdImportDeps = {
    readFile: async (path) => {
      const text = files[path];
      if (text === undefined) throw new Error("missing");
      return Buffer.from(text, "utf8");
    },
    store: async (file): Promise<GbdImportOutcome> => {
      if (known.includes(file.sha256))
        return { kind: "already-imported", sha256: file.sha256 };
      stored.push(file);
      return {
        kind: "imported",
        sha256: file.sha256,
        rowCount: file.rows.length,
        newRows: file.rows.length,
      };
    },
    stdout: { write: (chunk) => void out.push(chunk) },
    stderr: { write: (chunk) => void err.push(chunk) },
  };
  return { deps, out, err, stored };
};

const SHA = sha256Of(Buffer.from(MADE_UP_CAUSE_CSV, "utf8"));

describe("bun run gbd:import", () => {
  test("sha256Of is the hex SHA-256 of the bytes", () => {
    expect(sha256Of(Buffer.from("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  test("imports a file with its checksum and base name", async () => {
    const { deps, out, err, stored } = fakes({
      "/downloads/IHME-GBD_2023_DATA-1.csv": MADE_UP_CAUSE_CSV,
    });
    expect(await runGbdImport(["/downloads/IHME-GBD_2023_DATA-1.csv"], deps)).toBe(0);
    expect(out).toEqual([`IHME-GBD_2023_DATA-1.csv sha256 ${SHA}: 12 rows, 12 new\n`]);
    expect(err).toEqual([]);
    expect(stored.map((file) => [file.fileName, file.sha256, file.rows.length])).toEqual([
      ["IHME-GBD_2023_DATA-1.csv", SHA, 12],
    ]);
  });

  test("stores the citation from a citation.txt next to the file (#417)", async () => {
    const { deps, stored } = fakes({
      "/downloads/IHME-GBD_2023_DATA-1.csv": MADE_UP_CAUSE_CSV,
      "/downloads/citation.txt":
        "GBD Results tool:\nUse the following to cite data included in this download:\nA made-up citation.\n",
    });
    expect(await runGbdImport(["/downloads/IHME-GBD_2023_DATA-1.csv"], deps)).toBe(0);
    expect(stored.map((file) => file.citation)).toEqual(["A made-up citation."]);
  });

  test("a file without a citation.txt is stored without one", async () => {
    const { deps, stored } = fakes({ "/d/a.csv": MADE_UP_CAUSE_CSV });
    expect(await runGbdImport(["/d/a.csv"], deps)).toBe(0);
    expect(stored[0]?.citation).toBeUndefined();
  });

  test("a known checksum is skipped; a bad file is refused and the rest still run", async () => {
    const { deps, out, err } = fakes(
      { "a.csv": MADE_UP_CAUSE_CSV, "b.csv": "x,y\n1,2" },
      [SHA],
    );
    expect(await runGbdImport(["b.csv", "a.csv", "c.csv"], deps)).toBe(1);
    expect(out).toEqual([`a.csv sha256 ${SHA}: already imported, skipped\n`]);
    expect(err[0]?.startsWith("b.csv: GBD_CSV_COLUMNS: ")).toBe(true);
    expect(err[1]).toBe("c.csv: cannot be read\n");
  });

  test("no file is a usage error", async () => {
    const { deps, err } = fakes({});
    expect(await runGbdImport([], deps)).toBe(1);
    expect(err).toEqual(["usage: bun run gbd:import <file.csv> [more.csv ...]\n"]);
  });
});
