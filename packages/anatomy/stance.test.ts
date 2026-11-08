import { describe, expect, test } from "bun:test";

import { DEMO_BODY_IDS } from "./demo-bodies";
import { ATLAS_IDS } from "./manifest";
import {
  adductionToReach,
  ankleCentres,
  ankleOffsets,
  ankleSpread,
  DEMO_STANCE,
  type Point3,
} from "./stance";

/** Two rings of points, one per ankle, at `z`, centred on `left` and `right`. */
const ankles = (left: number, right: number, z: number): Point3[] =>
  [left, right].flatMap((x) =>
    Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * 2 * Math.PI;
      return { x: x + 0.03 * Math.cos(a), y: 0.03 * Math.sin(a), z };
    }),
  );

const frame = { floorZ: 0, height: 1.8, midX: 0 };

describe("ankleCentres", () => {
  test("finds each ankle's side-to-side centre inside the ankle slab", () => {
    const found = ankleCentres(ankles(0.2, -0.18, 0.1), frame);
    expect(found.left).toBeCloseTo(0.2, 9);
    expect(found.right).toBeCloseTo(-0.18, 9);
  });

  test("ignores points above or below the slab, such as knees and toes on the floor", () => {
    const points = [
      ...ankles(0.1, -0.1, 0.1),
      ...ankles(0.4, -0.4, 0.5),
      ...ankles(0.4, -0.4, 0.01),
    ];
    const found = ankleCentres(points, frame);
    expect(found.left).toBeCloseTo(0.1, 9);
    expect(found.right).toBeCloseTo(-0.1, 9);
  });

  test("says null for a side with nothing at ankle height", () => {
    const found = ankleCentres(ankles(0.1, -0.1, 0.1).slice(0, 12), frame);
    expect(found.left).toBeCloseTo(0.1, 9);
    expect(found.right).toBeNull();
    expect(ankleSpread(found)).toBeNull();
  });
});

describe("ankleSpread and ankleOffsets", () => {
  test("spread is left minus right; an offset is positive when the body ankle is outside", () => {
    const body = { left: 0.22, right: -0.22 };
    const atlas = { left: 0.075, right: -0.08 };
    expect(ankleSpread(body)).toBeCloseTo(0.44, 9);
    const offsets = ankleOffsets(body, atlas);
    expect(offsets.left).toBeCloseTo(0.145, 9);
    expect(offsets.right).toBeCloseTo(0.14, 9);
    expect(ankleOffsets({ left: 0.05, right: -0.05 }, atlas).left).toBeCloseTo(-0.025, 9);
  });
});

describe("adductionToReach", () => {
  /** Turns the ankle about the hip by `angle` toward the midline, front view. */
  const turn = (
    hip: { x: number; z: number },
    ankle: { x: number; z: number },
    angle: number,
  ): { x: number; z: number } => {
    const phi = hip.x >= 0 ? -angle : angle;
    const dx = ankle.x - hip.x;
    const dz = ankle.z - hip.z;
    return {
      x: hip.x + dx * Math.cos(phi) - dz * Math.sin(phi),
      z: hip.z + dx * Math.sin(phi) + dz * Math.cos(phi),
    };
  };

  test("the angle it gives puts either ankle over the target", () => {
    for (const [hip, ankle, target] of [
      [{ x: 0.09, z: 0.95 }, { x: 0.22, z: 0.08 }, 0.075],
      [{ x: -0.09, z: 0.95 }, { x: -0.22, z: 0.08 }, -0.075],
    ] as const) {
      const angle = adductionToReach(hip, ankle, target, 0);
      expect(angle).not.toBeNull();
      expect(angle ?? 0).toBeGreaterThan(0);
      expect(turn(hip, ankle, angle ?? 0).x).toBeCloseTo(target, 9);
    }
  });

  test("a target outside the ankle gives a negative angle, and one out of reach null", () => {
    const hip = { x: 0.09, z: 0.95 };
    const ankle = { x: 0.15, z: 0.08 };
    expect(adductionToReach(hip, ankle, 0.2, 0) ?? 0).toBeLessThan(0);
    expect(adductionToReach(hip, ankle, 2, 0)).toBeNull();
    expect(adductionToReach(hip, ankle, ankle.x, 0)).toBeCloseTo(0, 12);
  });
});

describe("DEMO_STANCE", () => {
  test("has a small hip angle for every demo body and atlas", () => {
    for (const body of DEMO_BODY_IDS) {
      for (const atlas of ATLAS_IDS) {
        const { hipAdductionDeg } = DEMO_STANCE[body][atlas];
        expect(Number.isFinite(hipAdductionDeg)).toBe(true);
        expect(Math.abs(hipAdductionDeg)).toBeLessThan(15);
      }
    }
  });
});
