import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEV_OPTIONS, generateW1 } from "../../synthetic-wearables/w1-items";
import { parseCsv } from "../rater-sheet";

import { studyItems } from "./counterfactual";
import { SHEET_COLUMNS } from "./rater";
import { runRater } from "./rater-run";
import { fakeModel, runStudy, studyCells } from "./run";

const dir = await mkdtemp(join(tmpdir(), "attribution-rater-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

const items = generateW1(DEV_OPTIONS);
const records = await runStudy({
  cells: studyCells(studyItems(items, false), ["C1"]),
  models: [fakeModel("cite_other")],
  repeats: 1,
});
const itemsPath = join(dir, "items.json");
const recordsPath = join(dir, "records.jsonl");
await writeFile(itemsPath, JSON.stringify({ testData: true, items }));
await writeFile(recordsPath, records.map((record) => JSON.stringify(record)).join("\n"));

const io = () => {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: { write: (chunk: string) => out.push(chunk) },
      stderr: { write: (chunk: string) => err.push(chunk) },
    },
    out,
    err,
  };
};

describe("runRater", () => {
  test("writes the sheet and key, then reads a filled sheet back to kappa", async () => {
    const first = io();
    const out = join(dir, "rater");
    expect(
      await runRater(
        ["--records", recordsPath, "--items", itemsPath, "--n", "20", "--out", out],
        first.io,
        () => "00112233445566778899aabbccddeeff",
      ),
    ).toBe(0);
    const sheet = await readFile(join(out, "sheet.csv"), "utf8");
    const [header, ...rows] = parseCsv(sheet);
    const column = SHEET_COLUMNS.indexOf("attribution_correct");
    const filled = [
      header!,
      ...rows
        .filter((row) => row.length > 1)
        .map((row) => row.map((cell, index) => (index === column ? "n" : cell))),
    ]
      .map((row) => row.map((cell) => JSON.stringify(cell)).join(","))
      .join("\n");
    await writeFile(join(out, "filled.csv"), filled);

    const second = io();
    expect(
      await runRater(
        [
          "--agreement",
          "--records",
          recordsPath,
          "--sheet",
          join(out, "filled.csv"),
          "--key",
          join(out, "key.json"),
        ],
        second.io,
      ),
    ).toBe(0);
    const agreement = await readFile(join(out, "agreement.md"), "utf8");
    expect(agreement).toContain("| attribution_correct | 20 |");
  });

  test("missing flags say what is needed", async () => {
    const result = io();
    expect(await runRater([], result.io)).toBe(1);
    expect(result.err.join("")).toContain("--records");
  });
});
