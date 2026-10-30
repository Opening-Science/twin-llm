import { describe, expect, test } from "bun:test";

import { mulberry32 } from "@/infrastructure/seeded-random";

import { AF_MAX_RR_MS, AF_MIN_RR_MS, afInterval, logNormalFor } from "./af-interval";

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
