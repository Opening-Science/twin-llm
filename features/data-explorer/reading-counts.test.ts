import { describe, expect, test } from "bun:test";

import { readingDistribution } from "./reading-counts";

const rows = (...readings: number[]) =>
  readings.map((value, index) => ({ subjectRef: `s-${index}`, readings: value }));

describe("readingDistribution", () => {
  test("bins of 500 to the largest count, with the subjects who have no row as 0", () => {
    const distribution = readingDistribution(rows(120, 480, 999, 1000, 2873), 7);
    expect(distribution.bins).toEqual([
      { from: 0, to: 499, subjects: 4 },
      { from: 500, to: 999, subjects: 1 },
      { from: 1000, to: 1499, subjects: 1 },
      { from: 1500, to: 1999, subjects: 0 },
      { from: 2000, to: 2499, subjects: 0 },
      { from: 2500, to: 2999, subjects: 1 },
    ]);
    expect(distribution.subjects).toBe(7);
    expect(distribution.withoutReadings).toBe(2);
    expect([distribution.min, distribution.median, distribution.max]).toEqual([
      0, 480, 2873,
    ]);
  });

  test("a largest count on a bin edge gets a bin of its own; an even count averages the middle two", () => {
    const distribution = readingDistribution(rows(10, 20), 2);
    expect(distribution.bins.length).toBe(11);
    expect(distribution.bins[5]).toEqual({ from: 10, to: 11, subjects: 1 });
    expect(distribution.bins[10]).toEqual({ from: 20, to: 21, subjects: 1 });
    expect(distribution.withoutReadings).toBe(0);
    expect(distribution.median).toBe(15);
  });

  test("bins run to the 90th percentile; the few above it share one open last bin", () => {
    const counts = [...Array.from({ length: 19 }, (_, i) => (i + 1) * 10), 5000];
    const distribution = readingDistribution(rows(...counts), 20);
    expect(distribution.bins.length).toBe(11);
    expect(distribution.bins[0]).toEqual({ from: 0, to: 19, subjects: 1 });
    expect(distribution.bins[9]).toEqual({ from: 180, to: 199, subjects: 2 });
    expect(distribution.bins[10]).toEqual({ from: 200, to: null, subjects: 1 });
    expect(distribution.max).toBe(5000);
  });

  test("a cohort with no subjects has no bins and no statistics, not zeros", () => {
    expect(readingDistribution([], 0)).toEqual({
      subjects: 0,
      withoutReadings: 0,
      bins: [],
      min: null,
      median: null,
      max: null,
    });
  });
});
