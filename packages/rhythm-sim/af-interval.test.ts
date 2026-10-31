import { describe, expect, test } from "bun:test";

import { mulberry32 } from "@/infrastructure/seeded-random";

import {
  AF_MAX_RR_MS,
  AF_MIN_RR_MS,
  AF_SHORT_RANGE_PHI,
  afInterval,
  afIntervalAfter,
  autocorrelation,
  logNormalFor,
} from "./af-interval";

describe("logNormalFor", () => {
  test("mean 600 ms, CV 0.2: σ² = ln 1.04, μ = ln 600 − σ²/2", () => {
    const shape = logNormalFor(600, 0.2);
    expect(shape.sigma).toBeCloseTo(Math.sqrt(Math.log(1.04)), 12);
    expect(shape.mu).toBeCloseTo(Math.log(600) - Math.log(1.04) / 2, 12);
  });
});

describe("afInterval", () => {
  test("10000 draws: mean about 600 ms, CV about 0.2, all within the floor and ceiling", () => {
    const random = mulberry32(5);
    const shape = logNormalFor(600, 0.2);
    const draws = Array.from({ length: 10_000 }, () => afInterval(random, shape));
    const mean = draws.reduce((a, b) => a + b, 0) / draws.length;
    const sd = Math.sqrt(draws.reduce((a, b) => a + (b - mean) ** 2, 0) / draws.length);
    expect(Math.abs(mean - 600) < 6).toBe(true);
    expect(Math.abs(sd / mean - 0.2) < 0.01).toBe(true);
    expect(Math.min(...draws) >= AF_MIN_RR_MS).toBe(true);
    expect(Math.max(...draws) <= AF_MAX_RR_MS).toBe(true);
  });

  test("a shape far below the floor is clamped to it after the redraws", () => {
    expect(afInterval(mulberry32(1), { mu: Math.log(10), sigma: 0.01 })).toBe(
      AF_MIN_RR_MS,
    );
  });
});

describe("autocorrelation", () => {
  test("1, 2, 3, 4 at lag 1: covariance 1.25 over 5 = 0.25", () => {
    expect(autocorrelation([1, 2, 3, 4], 1)).toBeCloseTo(0.25, 12);
  });

  test("an alternating series at lag 1 is −(n − 1)/n", () => {
    expect(autocorrelation([1, -1, 1, -1], 1)).toBeCloseTo(-0.75, 12);
  });

  test("null for a constant series, lag 0 or a lag as long as the series", () => {
    expect(autocorrelation([3, 3, 3], 1)).toBeNull();
    expect(autocorrelation([1, 2, 3], 0)).toBeNull();
    expect(autocorrelation([1, 2, 3], 3)).toBeNull();
  });
});

/** A series of `length` short_range intervals, ms, from one seed. */
const shortRangeSeries = (seed: number, length: number, phi: number): number[] => {
  const random = mulberry32(seed);
  const shape = logNormalFor(600, 0.2);
  return Array.from({ length }).reduce<{ out: number[]; state: number | null }>(
    (acc) => {
      const step = afIntervalAfter(random, shape, phi, acc.state);
      return { out: [...acc.out, step.rrMs], state: step.state };
    },
    { out: [], state: null },
  ).out;
};

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
};

describe("afIntervalAfter (short_range)", () => {
  test("no previous state: a fresh standard normal; φ 0 behaves like independent draws", () => {
    const step = afIntervalAfter(mulberry32(5), logNormalFor(600, 0.2), 0, null);
    expect(step.rrMs).toBe(afInterval(mulberry32(5), logNormalFor(600, 0.2)));
  });

  test("the state follows φ · previous + √(1 − φ²) · ε", () => {
    const shape = { mu: Math.log(600), sigma: 0.2 };
    const fresh = afIntervalAfter(mulberry32(9), shape, 0, null);
    const next = afIntervalAfter(mulberry32(9), shape, 0.5, 1);
    expect(next.state).toBeCloseTo(0.5 + Math.sqrt(0.75) * fresh.state, 12);
    expect(next.rrMs).toBeCloseTo(Math.exp(shape.mu + shape.sigma * next.state), 9);
  });

  test("20000 intervals: mean and CV as asked, lag-1 of ln RR about φ, lag 2 about φ², all in range", () => {
    const series = shortRangeSeries(297, 20_000, AF_SHORT_RANGE_PHI);
    const mean = series.reduce((a, b) => a + b, 0) / series.length;
    const sd = Math.sqrt(series.reduce((a, b) => a + (b - mean) ** 2, 0) / series.length);
    const logs = series.map(Math.log);
    expect(Math.abs(mean - 600) < 6).toBe(true);
    expect(Math.abs(sd / mean - 0.2) < 0.01).toBe(true);
    expect(Math.abs((autocorrelation(logs, 1) ?? 0) - AF_SHORT_RANGE_PHI) < 0.015).toBe(
      true,
    );
    expect(Math.abs(autocorrelation(logs, 2) ?? 1) < 0.015).toBe(true);
    expect(Math.min(...series) >= AF_MIN_RR_MS).toBe(true);
    expect(Math.max(...series) <= AF_MAX_RR_MS).toBe(true);
  });

  test("128-interval windows: median lag-1 of ln RR near the MIT-BIH AF Database target 0.045, independent draws near −0.008", () => {
    const windowMedian = (phi: number): number =>
      median(
        Array.from({ length: 400 }, (_, seed) =>
          autocorrelation(shortRangeSeries(seed + 1, 128, phi).map(Math.log), 1),
        ).map((value) => value ?? 0),
      );
    expect(Math.abs(windowMedian(AF_SHORT_RANGE_PHI) - 0.045) < 0.015).toBe(true);
    expect(Math.abs(windowMedian(0) + 0.008) < 0.015).toBe(true);
  });
});
