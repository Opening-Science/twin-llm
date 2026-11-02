import { describe, expect, test } from "bun:test";

import {
  byCluster,
  isFullAfWindow,
  parseRrGridArgs,
  type SimArm,
  studyResult,
  studyTable,
  type WindowValues,
  windowValues,
} from "./rr-grid-study";

const values = (cluster: string, tpr: number, sampEn = 2): WindowValues => ({
  cluster,
  values: {
    tpr,
    tpr_non_strict: tpr,
    tpr_ties_broken: tpr,
    sample_entropy: sampEn,
    tie_share: 0,
  },
});

describe("windowValues", () => {
  test("strict TPR from the window; non-strict and ties broken from its intervals", () => {
    const row = {
      cluster: "c",
      index: 0,
      rr: [700, 800, 800, 700],
      metrics: {
        nrmssd: 0.1,
        turning_point_ratio: 0,
        shannon_entropy: 0.5,
        sample_entropy: null,
      },
    };
    const out = windowValues(row, 1).values;
    expect(out.tpr).toBe(0);
    expect(out.tpr_non_strict).toBe(0.5);
    expect(out.tpr_ties_broken).toBe(0.25);
    expect(out.tie_share).toBeCloseTo(1 / 3);
    expect(windowValues(row, 1)).toEqual(windowValues(row, 1));
  });

  test("full all-AF windows only", () => {
    expect(isFullAfWindow({ n: 128, afShare: 1, singleLabel: true })).toBe(true);
    expect(isFullAfWindow({ n: 127, afShare: 1, singleLabel: true })).toBe(false);
    expect(isFullAfWindow({ n: 128, afShare: 0.9, singleLabel: false })).toBe(false);
  });
});

describe("studyResult", () => {
  const arm = (gridMs: number, tpr: number): SimArm => ({
    mode: "independent",
    gridMs,
    rows: ["a", "b", "c"].flatMap((cluster) => [
      values(cluster, tpr),
      values(cluster, tpr),
    ]),
  });
  const real = {
    database: "afdb" as const,
    rows: ["r1", "r2"].map((cluster) => values(cluster, 0.6, 1.5)),
  };

  test("gap and the share of it closed, with intervals", () => {
    const result = studyResult([arm(0, 0.7), arm(4, 0.65)], [real], 50, 1);
    const [zero, four] = result.sim;
    expect(zero.gaps.afdb?.tpr.median.gap.value).toBeCloseTo(0.1);
    expect(zero.gaps.afdb?.tpr.median.closed.value).toBe(0);
    expect(four.gaps.afdb?.tpr.median.gap.value).toBeCloseTo(0.05);
    expect(four.gaps.afdb?.tpr.mean.closed.value).toBeCloseTo(0.5);
    expect(four.gaps.afdb?.tpr.mean.closed.ci95.low).toBeCloseTo(0.5);
    expect(four.gaps.afdb?.tpr.ks).toBe(1);
    expect(four.gaps.afdb?.sample_entropy.median.gap.value).toBeCloseTo(0.5);
    expect(result.real[0]).toMatchObject({ records: 2, windows: 2 });
    expect(four).toMatchObject({ recordings: 3, windows: 6 });
    expect(result.real[0].centres.median.tpr.value).toBe(0.6);
  });

  test("no resamples gives no intervals", () => {
    const result = studyResult([arm(0, 0.7)], [real], 0, 1);
    expect(result.sim[0].centres.mean.tpr.ci95).toEqual({ low: null, high: null });
  });

  test("byCluster groups values per metric", () => {
    expect(byCluster([values("a", 1), values("b", 2), values("a", 3)]).tpr).toEqual([
      [1, 3],
      [2],
    ]);
  });

  test("the table has a row per source", () => {
    const table = studyTable(studyResult([arm(0, 0.7)], [real], 10, 1), "median");
    expect(table.split("\n")).toHaveLength(4);
    expect(table).toContain("| sim independent | 0 | 6 | 0.7000");
    expect(table).toContain("TPR (median)");
  });
});

describe("parseRrGridArgs", () => {
  test("defaults and errors", () => {
    expect(parseRrGridArgs(["--out", "o", "--afdb", "a", "--ltafdb", "l"])).toEqual({
      out: "o",
      afdb: "a",
      ltafdb: "l",
      seeds: 20,
      resamples: 1000,
      bootstrapSeed: 418,
    });
    expect(() => parseRrGridArgs(["--out", "o", "--afdb", "a"])).toThrow(
      "--ltafdb is required",
    );
    expect(() =>
      parseRrGridArgs(["--out", "o", "--afdb", "a", "--ltafdb", "l", "--seeds", "0"]),
    ).toThrow("--seeds must be an integer");
    expect(() => parseRrGridArgs(["--out", "o", "--grid"])).toThrow("unknown option");
    expect(() => parseRrGridArgs(["--out", "--afdb"])).toThrow("--out needs a value");
  });
});
