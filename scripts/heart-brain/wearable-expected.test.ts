import { describe, expect, test } from "bun:test";

import { type SubjectCondition } from "../synthetic-wearables/conditions";
import { subjectProfile } from "../synthetic-wearables/series";

import {
  clampedNormalMean,
  expectedDayValue,
  expectedRatio,
  normalCdf,
} from "./wearable-expected";

const heartFailure: SubjectCondition[] = [
  { kind: "heart_failure", onset: "2020-06-01", abatement: null },
];

describe("normalCdf", () => {
  test("matches known values", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 6);
    expect(normalCdf(-1)).toBeCloseTo(0.158655, 6);
  });
});

describe("clampedNormalMean", () => {
  test("far from both bounds it is the mean", () => {
    expect(clampedNormalMean(80, 6, 10, 150)).toBeCloseTo(80, 6);
  });

  test("a floor at the mean raises it by sd times phi(0)", () => {
    // E[max(m, m + sd Z)] = m + sd / sqrt(2 pi).
    expect(clampedNormalMean(10, 6, 10, 150)).toBeCloseTo(
      10 + 6 / Math.sqrt(2 * Math.PI),
      6,
    );
  });

  test("agrees with a large simulation", () => {
    let seed = 1;
    const uniform = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const draws = Array.from({ length: 200000 }, () => {
      const z = Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform());
      return Math.min(30000, Math.max(500, 2600 + 1800 * z));
    });
    const mean = draws.reduce((t, v) => t + v, 0) / draws.length;
    expect(Math.abs(clampedNormalMean(2600, 1800, 500, 30000) - mean)).toBeLessThan(15);
  });

  test("with no spread it is the clamped mean", () => {
    expect(clampedNormalMean(5, 0, 10, 150)).toBe(10);
  });
});

describe("expected ratios", () => {
  const key = "7:subject-1";
  const profile = subjectProfile(7, "subject-1");

  test("without floors, a weekday's steps are the profile times the factor", () => {
    const day = "2020-06-03"; // a Wednesday
    const factor =
      expectedDayValue("steps", key, heartFailure, day, false) / profile.steps;
    expect(factor).toBeGreaterThanOrEqual(0.6);
    expect(factor).toBeLessThanOrEqual(0.7);
  });

  test("the floor lifts the after mean more than the before mean", () => {
    const before = ["2020-05-27", "2020-05-28"];
    const after = ["2020-06-03", "2020-06-04"];
    for (const metric of ["steps", "hrv_rmssd"] as const) {
      const withFloors = expectedRatio(metric, key, heartFailure, before, after) ?? 0;
      const without = expectedRatio(metric, key, heartFailure, before, after, false) ?? 0;
      expect(withFloors).toBeGreaterThanOrEqual(without);
    }
    expect(expectedRatio("steps", key, heartFailure, [], after)).toBeNull();
  });
});
