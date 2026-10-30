import { describe, expect, test } from "bun:test";

import { randomFor } from "@/infrastructure/seeded-random";

import {
  auroc,
  clusterBootstrap,
  ksStatistic,
  midRanks,
  quantileSorted,
  rocPoints,
  sensitivity,
  specificity,
  wasserstein1,
} from "./statistics";

const ROWS = [
  { positive: true, flagged: true },
  { positive: true, flagged: true },
  { positive: true, flagged: false },
  { positive: false, flagged: false },
  { positive: false, flagged: true },
];

describe("sensitivity and specificity", () => {
  test("counts and shares", () => {
    expect(sensitivity(ROWS)).toEqual({ k: 2, n: 3, value: 2 / 3 });
    expect(specificity(ROWS)).toEqual({ k: 1, n: 2, value: 0.5 });
  });

  test("null without the class", () => {
    expect(sensitivity([{ positive: false, flagged: false }])).toEqual({
      k: 0,
      n: 0,
      value: null,
    });
  });
});

describe("midRanks and auroc", () => {
  test("ties share the mean rank", () => {
    expect(midRanks([3, 1, 3, 2])).toEqual([3.5, 1, 3.5, 2]);
  });

  test("perfect, reversed, tied and partial separation", () => {
    expect(auroc([3, 4], [1, 2])).toBe(1);
    expect(auroc([1, 2], [3, 4])).toBe(0);
    expect(auroc([1, 1], [1, 1])).toBe(0.5);
    // Pairs: (2>1) (2<3) (4>1) (4>3) = 3 of 4.
    expect(auroc([2, 4], [1, 3])).toBe(0.75);
    expect(auroc([], [1])).toBe(null);
  });
});

describe("rocPoints", () => {
  test("from (0, 0) to (1, 1), one point per distinct score", () => {
    expect(rocPoints([2, 4], [1, 3])).toEqual([
      { threshold: Infinity, fpr: 0, tpr: 0 },
      { threshold: 4, fpr: 0, tpr: 0.5 },
      { threshold: 3, fpr: 0.5, tpr: 0.5 },
      { threshold: 2, fpr: 0.5, tpr: 1 },
      { threshold: 1, fpr: 1, tpr: 1 },
    ]);
  });
});

describe("quantileSorted", () => {
  test("type 7 interpolation", () => {
    expect(quantileSorted([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantileSorted([1, 2, 3, 4], 0)).toBe(1);
    expect(quantileSorted([1, 2, 3, 4], 1)).toBe(4);
    expect(quantileSorted([], 0.5)).toBe(null);
  });
});

describe("clusterBootstrap", () => {
  const mean = (rows: readonly number[]) =>
    rows.length === 0 ? null : rows.reduce((a, b) => a + b, 0) / rows.length;

  test("identical clusters give a zero-width interval", () => {
    const result = clusterBootstrap(
      [
        [1, 3],
        [1, 3],
        [1, 3],
      ],
      mean,
      200,
      randomFor(1, "b"),
    );
    expect(result).toEqual({ value: 2, ci95: { low: 2, high: 2 } });
  });

  test("seeded and within the range of cluster means", () => {
    const clusters = [[0], [1], [2], [3], [4]];
    const a = clusterBootstrap(clusters, mean, 500, randomFor(9, "b"));
    const b = clusterBootstrap(clusters, mean, 500, randomFor(9, "b"));
    expect(a).toEqual(b);
    expect(a.value).toBe(2);
    expect((a.ci95.low ?? -1) >= 0 && (a.ci95.high ?? 5) <= 4).toBe(true);
    expect((a.ci95.low ?? 2) < 2 && (a.ci95.high ?? 2) > 2).toBe(true);
  });

  test("no resamples, no interval", () => {
    expect(clusterBootstrap([[1]], mean, 0, randomFor(1, "b"))).toEqual({
      value: 1,
      ci95: { low: null, high: null },
    });
  });
});

describe("wasserstein1 and ksStatistic", () => {
  test("a shift by d has W1 = d", () => {
    expect(wasserstein1([0, 1, 2], [5, 6, 7])).toBe(5);
    expect(wasserstein1([1, 2, 3], [3, 2, 1])).toBe(0);
  });

  test("W1 of unequal sizes", () => {
    // F jumps to 1 at 0; G is 0.5 at 0 and 1 at 2: integral of 0.5 over [0, 2].
    expect(wasserstein1([0], [0, 2])).toBe(1);
  });

  test("KS", () => {
    expect(ksStatistic([1, 2, 3], [1, 2, 3])).toBe(0);
    expect(ksStatistic([1, 2], [3, 4])).toBe(1);
    expect(ksStatistic([1, 2, 3, 4], [3, 4, 5, 6])).toBe(0.5);
    expect(ksStatistic([], [1])).toBe(null);
  });
});
