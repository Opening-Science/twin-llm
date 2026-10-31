import { describe, expect, test } from "bun:test";

import { distanceOf, distances, QUANTITIES, valuesOf } from "./distance";
import { type WindowRow } from "./windows";

const row = (rr: readonly number[], nrmssd: number | null): WindowRow => ({
  cluster: "c",
  index: 0,
  n: rr.length,
  meanRrMs: rr.reduce((a, b) => a + b, 0) / rr.length,
  rr,
  afShare: 0,
  dominant: "N",
  singleLabel: true,
  positive: false,
  flagged: false,
  metrics: { nrmssd, turning_point_ratio: 0.5, shannon_entropy: 0.8, sample_entropy: 1 },
});

describe("valuesOf", () => {
  const rows = [row([800, 1000, 900], 0.1), row([500, 500], null)];

  test("interval quantities", () => {
    expect(valuesOf(rows, "rr_ms")).toEqual([800, 1000, 900, 500, 500]);
    expect(valuesOf(rows, "drr_ms")).toEqual([200, -100, 0]);
    expect(valuesOf(rows, "rr_norm")).toEqual([800 / 900, 1000 / 900, 1, 1, 1]);
    expect(valuesOf(rows, "drr_norm")).toEqual([200 / 900, -100 / 900, 0]);
    expect(valuesOf(rows, "mean_rr_ms")).toEqual([900, 500]);
  });

  test("lag-1 autocorrelation of ln RR; a constant window has none", () => {
    const values = valuesOf(
      [
        row(
          [1, 2, 3, 4].map((value) => Math.exp(value)),
          null,
        ),
        row([500, 500], null),
      ],
      "lag1_log_rr",
    );
    expect(values.length).toBe(1);
    expect(values[0]).toBeCloseTo(0.25, 12);
  });

  test("metrics leave out nulls", () => {
    expect(valuesOf(rows, "nrmssd")).toEqual([0.1]);
  });
});

describe("distanceOf", () => {
  test("a shift", () => {
    expect(distanceOf("rr_ms", [1, 2, 3], [2, 3, 4])).toEqual({
      quantity: "rr_ms",
      nSim: 3,
      nReal: 3,
      wasserstein1: 1,
      wasserstein1InRealSd: 1,
      ks: 1 - 2 / 3,
      simMedian: 2,
      realMedian: 3,
    });
  });

  test("empty sides give nulls", () => {
    expect(distanceOf("nrmssd", [], [1]).wasserstein1).toBe(null);
  });

  test("one distance per quantity", () => {
    expect(
      distances([row([800, 900], 0.1)], [row([800, 900], 0.1)]).map((d) => d.quantity),
    ).toEqual([...QUANTITIES]);
  });
});
