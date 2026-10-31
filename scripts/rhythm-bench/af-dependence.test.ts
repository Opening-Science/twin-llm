import { describe, expect, test } from "bun:test";

import { lagSummary, median, windowLag } from "./af-dependence";

describe("median", () => {
  test("odd, even and empty", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("windowLag", () => {
  test("lag-1 autocorrelation of ln RR", () => {
    const rr = [1, 2, 3, 4].map((value) => Math.exp(value));
    expect(windowLag({ rr }, 1)).toBeCloseTo(0.25, 12);
    expect(windowLag({ rr: [600, 600, 600] }, 1)).toBeNull();
  });
});

describe("lagSummary", () => {
  const up = [1, 2, 3, 4].map((value) => Math.exp(value));
  const alternate = [1, -1, 1, -1].map((value) => Math.exp(value));

  test("pooled over windows and over cluster medians; undefined windows left out", () => {
    const summary = lagSummary(
      [
        { cluster: "a", rr: up },
        { cluster: "a", rr: up },
        { cluster: "a", rr: up },
        { cluster: "b", rr: alternate },
        { cluster: "c", rr: [700, 700, 700] },
      ],
      1,
    );
    expect(summary).toEqual({
      lag: 1,
      windows: 4,
      clusters: 2,
      pooledMedian: 0.25,
      medianOfClusterMedians: (0.25 - 0.75) / 2,
    });
  });

  test("no rows: nulls", () => {
    expect(lagSummary([], 2)).toEqual({
      lag: 2,
      windows: 0,
      clusters: 0,
      pooledMedian: null,
      medianOfClusterMedians: null,
    });
  });
});
