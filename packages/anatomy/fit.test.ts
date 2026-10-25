import { describe, expect, test } from "bun:test";
import { Box3, Vector3 } from "three";

import {
  atlasToScanRotation,
  fitAtlasToScan,
  type AtlasFrame,
  type ScanFrame,
} from "./fit";

const round = (v: Vector3): readonly number[] =>
  [v.x, v.y, v.z].map((n) => Math.round(n * 1e6) / 1e6 + 0);

/** A synthetic 1.70 m atlas: feet at y=0, x centred, z from -0.05 to 0.25. */
const atlas = (overrides: Partial<AtlasFrame> = {}): AtlasFrame => ({
  box: new Box3(new Vector3(-0.33, 0, -0.05), new Vector3(0.33, 1.7, 0.25)),
  hipAnchor: { x: 0, z: 0.07 },
  mirrorX: false,
  ...overrides,
});

/** A synthetic 1.87 m scan, Z-up, floor at z=0, hips at (0.01, 0.02, 0.97). */
const scan = (overrides: Partial<ScanFrame> = {}): ScanFrame => ({
  box: new Box3(new Vector3(-0.5, -0.2, 0), new Vector3(0.5, 0.22, 1.87)),
  floorZ: 0,
  height: 1.87,
  stature: null,
  hipMidpoint: new Vector3(0.01, 0.02, 0.97),
  ...overrides,
});

describe("atlasToScanRotation", () => {
  test("up goes to +Z, front to -Y, left stays +X, no mirror", () => {
    const r = atlasToScanRotation();
    expect(round(new Vector3(0, 1, 0).transformDirection(r))).toEqual([0, 0, 1]);
    expect(round(new Vector3(0, 0, 1).transformDirection(r))).toEqual([0, -1, 0]);
    expect(round(new Vector3(1, 0, 0).transformDirection(r))).toEqual([1, 0, 0]);
    expect(r.determinant()).toBeCloseTo(1, 9);
  });
});

describe("fitAtlasToScan", () => {
  test("scales by height, puts the feet on the floor and aligns the hips", () => {
    const fit = fitAtlasToScan(atlas(), scan());
    expect(fit.ok).toBe(true);
    expect(fit.anchor).toBe("hips");
    expect(fit.scale).toBeCloseTo(1.1, 9);
    // atlas hip anchor (x=0, z=0.07) at any height → scan hips horizontally
    const hip = new Vector3(0, 0.9, 0.07).applyMatrix4(fit.matrix);
    expect(hip.x).toBeCloseTo(0.01, 9);
    expect(hip.y).toBeCloseTo(0.02, 9);
    // feet (y=0) land on the floor, the top of the head at the scan height
    expect(new Vector3(0, 0, 0.1).applyMatrix4(fit.matrix).z).toBeCloseTo(0, 9);
    expect(new Vector3(0, 1.7, 0.1).applyMatrix4(fit.matrix).z).toBeCloseTo(1.87, 9);
    // the atlas front (+Z) faces the scan front (-Y)
    const back = new Vector3(0, 1, 0).applyMatrix4(fit.matrix);
    const front = new Vector3(0, 1, 0.2).applyMatrix4(fit.matrix);
    expect(front.y).toBeLessThan(back.y);
    expect(fit.matrix.determinant()).toBeCloseTo(1.1 ** 3, 9);
  });

  test("falls back to bbox centres when the scan has no hip joints", () => {
    const fit = fitAtlasToScan(atlas(), scan({ hipMidpoint: null }));
    expect(fit.anchor).toBe("bbox");
    const centre = new Vector3(0, 0.85, 0.1).applyMatrix4(fit.matrix);
    expect(centre.x).toBeCloseTo(0, 9);
    expect(centre.y).toBeCloseTo(0.01, 9);
  });

  test("a mirrored atlas flips x and the determinant", () => {
    const fit = fitAtlasToScan(atlas({ mirrorX: true }), scan());
    expect(fit.matrix.determinant()).toBeCloseTo(-(1.1 ** 3), 9);
    const left = new Vector3(0.1, 0.9, 0.07).applyMatrix4(fit.matrix);
    expect(left.x).toBeCloseTo(0.01 - 0.11, 9);
  });

  test("scales by measured stature when the scan has one, by the box otherwise", () => {
    const measured = fitAtlasToScan(atlas(), scan({ stature: 1.8 }));
    expect(measured.ok).toBe(true);
    expect(measured.scale).toBeCloseTo(1.8 / 1.7, 9);
    // feet stay on the floor; the atlas vertex lands at the stature, below the hair
    expect(new Vector3(0, 0, 0.1).applyMatrix4(measured.matrix).z).toBeCloseTo(0, 9);
    expect(new Vector3(0, 1.7, 0.1).applyMatrix4(measured.matrix).z).toBeCloseTo(1.8, 9);

    const boxed = fitAtlasToScan(atlas(), scan({ stature: null }));
    expect(boxed.scale).toBeCloseTo(1.87 / 1.7, 9);
    expect(new Vector3(0, 1.7, 0.1).applyMatrix4(boxed.matrix).z).toBeCloseTo(1.87, 9);
  });

  test("refuses implausible scales and empty boxes", () => {
    expect(fitAtlasToScan(atlas(), scan({ height: 0.5 })).ok).toBe(false);
    expect(fitAtlasToScan(atlas(), scan({ height: 3.2 })).ok).toBe(false);
    expect(fitAtlasToScan(atlas({ box: new Box3() }), scan()).ok).toBe(false);
  });
});
