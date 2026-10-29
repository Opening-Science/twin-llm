import { describe, expect, test } from "bun:test";

import { benchmarkCsv, benchmarkTable, parseBenchmark } from "./benchmark-result";

const FILE = JSON.stringify({
  run_id: "bench-2026-10-30",
  date: "2026-10-30",
  seed: 42,
  tables: [
    {
      title: "Flag on simulated windows",
      columns: ["Length (s)", "Sensitivity", "Specificity", "Note"],
      rows: [
        [300, 0.98765, 1, null],
        [60, 0.5, 0.9, "short"],
      ],
    },
  ],
});

describe("parseBenchmark", () => {
  test("missing, unreadable and found", () => {
    expect(parseBenchmark(null)).toEqual({ kind: "missing" });
    expect(parseBenchmark("not json")).toEqual({ kind: "unreadable" });
    expect(parseBenchmark('{"run_id": "x"}')).toEqual({ kind: "unreadable" });
    const read = parseBenchmark(FILE);
    expect(read.kind === "found" && read.result.tables[0]?.rows.length).toBe(2);
  });
});

describe("benchmarkTable and benchmarkCsv", () => {
  const read = parseBenchmark(FILE);
  const table = read.kind === "found" ? read.result.tables[0]! : null;

  test("shows whole numbers as they are and others to three decimals", () => {
    expect(benchmarkTable(table!).rows).toEqual([
      ["300", "0.988", "1", "—"],
      ["60", "0.500", "0.900", "short"],
    ]);
  });

  test("the CSV keeps the file's values", () => {
    expect(benchmarkCsv(table!)).toBe(
      "Length (s),Sensitivity,Specificity,Note\r\n300,0.98765,1,\r\n60,0.5,0.9,short\r\n",
    );
  });
});
