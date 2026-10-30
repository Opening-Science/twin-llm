import { describe, expect, test } from "bun:test";

import { clustersOf, metricAuroc, summarise, summariseBy } from "./analysis";
import { type WindowRow } from "./windows";

const row = (
  cluster: string,
  positive: boolean,
  flagged: boolean,
  nrmssd: number | null,
): WindowRow => ({
  cluster,
  index: 0,
  n: 128,
  meanRrMs: 800,
  rr: [],
  afShare: positive ? 1 : 0,
  dominant: positive ? "af" : "sinus",
  singleLabel: true,
  positive,
  flagged,
  metrics: {
    nrmssd,
    turning_point_ratio: 0.6,
    shannon_entropy: 0.9,
    sample_entropy: null,
  },
});

const ROWS = [
  row("a", true, true, 0.3),
  row("a", false, false, 0.05),
  row("b", true, false, 0.08),
  row("b", false, true, 0.2),
  row("c", true, true, null),
];

describe("clustersOf", () => {
  test("groups in first-seen order", () => {
    expect(clustersOf(ROWS).map((group) => group.length)).toEqual([2, 2, 1]);
  });
});

describe("summarise", () => {
  test("counts, point estimates and null handling", () => {
    const summary = summarise("all", ROWS, 100, 1);
    expect(summary).toMatchObject({
      key: "all",
      nWindows: 5,
      nClusters: 3,
      nPositive: 3,
      nNegative: 2,
      nMixed: 0,
      sensitivity: { k: 2, n: 3, value: 2 / 3 },
      specificity: { k: 1, n: 2, value: 0.5 },
    });
    // Positives 0.3, 0.08 against negatives 0.05, 0.2: 3 of 4 pairs.
    expect(summary.auroc.nrmssd.value).toBe(0.75);
    expect(summary.auroc.nrmssd.nullPositive).toBe(1);
    expect(summary.auroc.turning_point_ratio.value).toBe(0.5);
    expect(summary.auroc.sample_entropy.value).toBe(null);
    expect(metricAuroc(ROWS, "nrmssd")).toBe(0.75);
  });

  test("seeded: the same inputs give the same intervals", () => {
    expect(summarise("x", ROWS, 200, 5)).toEqual(summarise("x", ROWS, 200, 5));
  });

  test("summariseBy makes one summary per key", () => {
    expect(
      summariseBy("cluster", ROWS, (each) => each.cluster, 0, 1).map((s) => [
        s.key,
        s.nWindows,
      ]),
    ).toEqual([
      ["cluster=a", 2],
      ["cluster=b", 2],
      ["cluster=c", 1],
    ]);
  });
});
