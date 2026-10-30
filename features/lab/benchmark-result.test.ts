import { describe, expect, test } from "bun:test";

import { runBenchmark } from "@/scripts/rhythm-bench/benchmark";
import {
  AF_RATES,
  NOISE_LEVELS,
  RHYTHM_CONDITIONS,
} from "@/scripts/rhythm-bench/sim-grid";

import {
  benchmarkRunLine,
  benchmarkTables,
  newestRun,
  parseBenchmark,
} from "./benchmark-result";

/** The benchmark itself on a tiny grid, written as run.ts writes result.json. */
const resultText = (): string => {
  const data = runBenchmark({
    options: {
      seeds: 1,
      bootstrapSeed: 249,
      resamples: 5,
      grid: {
        durations: [300],
        rhythms: RHYTHM_CONDITIONS.filter((each) =>
          ["sinus", "persistent"].includes(each.id),
        ),
        afRates: [AF_RATES[1]!],
        noise: NOISE_LEVELS.filter((each) => each.id === "none"),
      },
    },
    gitSha: "0123456789abcdef",
    afdb: null,
  });
  return JSON.stringify({ generatedAt: "2026-10-30T10:00:00.000Z", ...data.result });
};

describe("parseBenchmark", () => {
  test("reads the benchmark's own result.json", () => {
    const read = parseBenchmark(resultText());
    expect(read.kind).toBe("found");
    if (read.kind !== "found") return;
    expect(read.result.options.seeds).toBe(1);
    expect(read.result.real).toBeNull();
  });

  test("missing and unreadable", () => {
    expect(parseBenchmark(null)).toEqual({ kind: "missing" });
    expect(parseBenchmark("{")).toEqual({ kind: "unreadable" });
    expect(parseBenchmark('{"benchmark":"other"}')).toEqual({ kind: "unreadable" });
  });
});

describe("benchmarkTables", () => {
  const read = parseBenchmark(resultText());
  const result = read.kind === "found" ? read.result : null;

  test("simulated table only without a database; overall rows first", () => {
    const tables = benchmarkTables(result!);
    expect(tables.map((each) => each.slug)).toEqual(["simulated"]);
    const rows = tables[0]!.table.rows;
    expect(rows.map((row) => row[0])).toEqual([
      "All windows",
      "Windows of one rhythm only",
      "duration 300s",
      "rhythm sinus",
      "rhythm persistent",
      "afRate 100",
      "noise none",
    ]);
    expect(tables[0]!.table.columns.length).toBe(rows[0]!.length);
  });

  test("cells carry the value with its interval, and the CSV the raw numbers", () => {
    const table = benchmarkTables(result!)[0]!;
    const overall = result!.simulated.overall;
    expect(table.table.rows[0]![1]).toBe(String(overall.nWindows));
    const csvFirst = table.csv.split("\r\n")[1]!.split(",");
    expect(csvFirst.slice(0, 5)).toEqual([
      "All windows",
      String(overall.nWindows),
      String(overall.nPositive),
      String(overall.nNegative),
      String(overall.nMixed),
    ]);
    expect(csvFirst[5]).toBe(String(overall.sensitivity.value ?? ""));
  });

  test("benchmarkRunLine names the run", () => {
    expect(benchmarkRunLine(result!)).toBe(
      `Run ${result!.runId} · 30 Oct 2026 · 1 seed per cell · 5 bootstrap resamples · ${result!.simulated.windows} simulated windows · no database · git 0123456789ab`,
    );
  });
});

describe("newestRun", () => {
  test("by generatedAt, then folder name; null when there are none", () => {
    const at = (generatedAt: string) => {
      const read = parseBenchmark(
        resultText().replace("2026-10-30T10:00:00.000Z", generatedAt),
      );
      return read;
    };
    const runs = [
      { dir: "b", read: at("2026-10-01T00:00:00.000Z") },
      { dir: "a", read: at("2026-10-29T00:00:00.000Z") },
      { dir: "z", read: { kind: "unreadable" } as const },
    ];
    expect(newestRun(runs)?.dir).toBe("a");
    expect(newestRun([])).toBeNull();
  });
});
