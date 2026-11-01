import { describe, expect, test } from "bun:test";

import {
  insideRing,
  nestRings,
  roundRing,
  signedArea,
  simplifyFeature,
  simplifyRing,
} from "./simplify";

/** Clockwise, as a shapefile winds an outer ring. */
const square = (x: number, y: number, size: number) =>
  [
    [x, y],
    [x, y + size],
    [x + size, y + size],
    [x + size, y],
    [x, y],
  ] as const;

describe("simplifyRing", () => {
  test("drops points within the tolerance of the line", () => {
    expect(
      simplifyRing(
        [
          [0, 0],
          [0, 5],
          [0.01, 10],
          [10, 10],
          [10, 0],
          [5, 0.01],
          [0, 0],
        ],
        0.1,
      ),
    ).toEqual([
      [0, 0],
      [0.01, 10],
      [10, 10],
      [10, 0],
      [0, 0],
    ]);
  });

  test("keeps a point farther than the tolerance", () => {
    expect(
      simplifyRing(
        [
          [0, 0],
          [0, 5],
          [1, 10],
          [10, 10],
          [10, 0],
          [0, 0],
        ],
        0.5,
      ),
    ).toHaveLength(5);
  });

  test("leaves a ring of four points or fewer alone", () => {
    const ring = [
      [0, 0],
      [0, 1],
      [1, 1],
      [0, 0],
    ] as const;
    expect(simplifyRing(ring, 10)).toBe(ring);
  });
});

describe("signedArea", () => {
  test("is negative clockwise and positive counter-clockwise", () => {
    expect(signedArea(square(0, 0, 2))).toBe(-4);
    expect(signedArea([...square(0, 0, 2)].reverse())).toBe(4);
  });
});

describe("roundRing", () => {
  test("rounds and drops repeated points", () => {
    expect(
      roundRing(
        [
          [0.001, 0.004],
          [0.004, 0.001],
          [1.006, 2],
        ],
        2,
      ),
    ).toEqual([
      [0, 0],
      [1.01, 2],
    ]);
  });
});

describe("insideRing", () => {
  test("tells inside from outside", () => {
    expect(insideRing([1, 1], square(0, 0, 2))).toBe(true);
    expect(insideRing([3, 1], square(0, 0, 2))).toBe(false);
  });
});

describe("nestRings", () => {
  test("puts each hole in the outer ring that holds it, wound as GeoJSON wants", () => {
    const hole = [...square(1, 1, 1)].reverse();
    const nested = nestRings([square(0, 0, 4), hole, square(10, 10, 1)]);
    expect(nested.map((polygon) => polygon.map((ring) => signedArea(ring)))).toEqual([
      [16, -1],
      [1],
    ]);
  });
});

describe("simplifyFeature", () => {
  test("drops rings under the minimum area but keeps the largest", () => {
    const options = { tolerance: 0, minArea: 2, decimals: 3 };
    expect(simplifyFeature([square(0, 0, 1), square(5, 5, 0.5)], options)).toEqual([
      square(0, 0, 1),
    ]);
    expect(
      simplifyFeature([square(0, 0, 3), square(5, 5, 1)], options).map(signedArea),
    ).toEqual([-9]);
  });
});
