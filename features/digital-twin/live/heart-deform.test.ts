import { describe, expect, test } from "bun:test";

import {
  atrialWeights,
  CONTRACTION,
  createHeartDeformer,
  HEART_AXIS,
  regionCentres,
} from "./heart-deform";

// Five points along the y axis, base (top) to apex (bottom), with a downward axis:
// 0, 0.25, 0.4, 0.75 and 1 of the way from base to apex.
const DOWN = [0, -1, 0] as const;
const COLUMN = new Float32Array([0, 1, 0, 0, 0.75, 0, 0, 0.6, 0, 0, 0.25, 0, 0, 0, 0]);

describe("atrialWeights", () => {
  test("the base third is atrial, the apex half ventricular, a smooth blend between", () => {
    const weights = [...atrialWeights(COLUMN, DOWN)];
    // 0.6 as a 32-bit float is not exactly 0.6, so the middle weight is only close to 0.5.
    expect([weights[0], weights[1], weights[3], weights[4]]).toEqual([1, 1, 0, 0]);
    expect(weights[2]).toBeCloseTo(0.5, 6);
  });

  test("a flat set of points has no atrial region", () => {
    expect([...atrialWeights(new Float32Array([1, 0, 0, 2, 0, 0]), DOWN)]).toEqual([
      0, 0,
    ]);
  });

  test("the default axis points left, down and forward", () => {
    expect(HEART_AXIS[0]).toBeGreaterThan(0);
    expect(HEART_AXIS[1]).toBeLessThan(0);
    expect(HEART_AXIS[2]).toBeGreaterThan(0);
    expect(Math.hypot(...HEART_AXIS)).toBeCloseTo(1, 12);
  });
});

describe("regionCentres", () => {
  test("weighted centres of each region", () => {
    const weights = new Float32Array([1, 1, 0.5, 0, 0]);
    const centres = regionCentres(COLUMN, weights);
    expect(centres.atria[0]).toBe(0);
    expect(centres.atria[1]).toBeCloseTo((1 + 0.75 + 0.3) / 2.5, 6);
    expect(centres.ventricles[1]).toBeCloseTo((0.3 + 0.25 + 0) / 2.5, 6);
  });
});

describe("createHeartDeformer", () => {
  const weights = new Float32Array([1, 1, 0.5, 0, 0]);
  const centres = { atria: [0, 1, 0], ventricles: [0, 0, 0] } as const;

  test("no contraction gives the rest positions back exactly", () => {
    const deformer = createHeartDeformer(COLUMN, weights, centres);
    expect([...deformer.apply(0, 0)]).toEqual([...COLUMN]);
  });

  test("each region pulls towards its own centre, by its weight", () => {
    const deformer = createHeartDeformer(COLUMN, weights, centres);
    const out = deformer.apply(1, 0);
    // Atria only: the 0.75 point moves up by 8 % of 0.25; the apex stays.
    expect(out[4]).toBeCloseTo(0.75 + 0.25 * CONTRACTION.atria, 6);
    expect(out[13]).toBe(0);
    const both = deformer.apply(0, 1);
    // Ventricles only: the 0.25 point moves 10 % towards y = 0; the base stays.
    expect(both[10]).toBeCloseTo(0.25 * (1 - CONTRACTION.ventricles), 6);
    expect(both[1]).toBe(1);
    // The blended middle point moves half as far with each.
    expect(deformer.apply(0, 1)[7]).toBeCloseTo(
      0.6 - 0.6 * 0.5 * CONTRACTION.ventricles,
      6,
    );
    expect(deformer.apply(1, 1)).toBe(deformer.positions);
  });
});
