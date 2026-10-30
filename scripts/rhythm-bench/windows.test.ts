import { describe, expect, test } from "bun:test";

import { irregularityWindow } from "@/packages/query-tools/stats";

import {
  dominantLabel,
  isMixed,
  labelledWindows,
  WINDOW_BEATS,
  windowRow,
} from "./windows";

const isAf = (label: string) => label === "af";

const series = (n: number): number[] =>
  Array.from({ length: n }, (_, i) => 700 + ((i * 37) % 200));

describe("dominantLabel", () => {
  test("most frequent, first seen on a tie", () => {
    expect(dominantLabel(["a", "b", "b"])).toBe("b");
    expect(dominantLabel(["a", "b"])).toBe("a");
  });
});

describe("windowRow", () => {
  test("metrics are the tool's irregularityWindow", () => {
    const rr = series(128);
    const row = windowRow(
      "c",
      0,
      rr,
      Array.from({ length: 128 }, () => "af"),
      isAf,
    );
    const tool = irregularityWindow(rr);
    expect(row.metrics).toEqual({
      nrmssd: tool.nrmssd,
      turning_point_ratio: tool.turning_point_ratio,
      shannon_entropy: tool.shannon_entropy,
      sample_entropy: tool.sample_entropy,
    });
    expect(row.flagged).toBe(tool.flagged);
    expect(row.singleLabel).toBe(true);
  });

  test("AF when at least half the intervals are AF", () => {
    const rr = [800, 810, 790, 805];
    expect(windowRow("c", 0, rr, ["af", "af", "sinus", "sinus"], isAf).positive).toBe(
      true,
    );
    const row = windowRow("c", 0, rr, ["af", "sinus", "sinus", "pac"], isAf);
    expect(row.positive).toBe(false);
    expect(row.afShare).toBe(0.25);
    expect(isMixed(row)).toBe(true);
    expect(row.meanRrMs).toBe(801.25);
    expect(row.dominant).toBe("sinus");
    expect(row.singleLabel).toBe(false);
  });
});

describe("labelledWindows", () => {
  test("consecutive 128-interval windows, tail left out", () => {
    const rr = series(300);
    const rows = labelledWindows(
      "c",
      rr,
      rr.map(() => "sinus"),
      isAf,
      true,
      5,
    );
    expect(rows.map((row) => [row.index, row.n])).toEqual([
      [5, WINDOW_BEATS],
      [6, WINDOW_BEATS],
    ]);
    expect(rows[1].rr).toEqual(rr.slice(128, 256));
  });

  test("a short series is one window only when asked", () => {
    const rr = series(40);
    const labels = rr.map(() => "sinus");
    expect(labelledWindows("c", rr, labels, isAf, true).map((row) => row.n)).toEqual([
      40,
    ]);
    expect(labelledWindows("c", rr, labels, isAf, false)).toEqual([]);
    expect(labelledWindows("c", [800, 800], ["sinus", "sinus"], isAf, true)).toEqual([]);
  });
});
