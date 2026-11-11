import { describe, expect, test } from "bun:test";

import {
  bodyCentre,
  explodeOffset,
  explodeVectors,
  meshVolume,
  parseExplode,
  type ExplodeInput,
} from "./explode";

const part = (
  centre: readonly [number, number, number],
  radius = 0.05,
  weight = 1,
): ExplodeInput => ({ centre, radius, weight, given: null });

const rounded = (values: readonly number[]): readonly number[] =>
  values.map((value) => Math.round(value * 1e6) / 1e6 + 0);

describe("bodyCentre", () => {
  test("is weighted by volume", () => {
    expect(
      rounded(bodyCentre([part([0, 0, 0], 0.1, 3), part([0, 0.4, 0], 0.1, 1)])),
    ).toEqual([0, 0.1, 0]);
  });

  test("falls back to a plain mean when no weight is positive", () => {
    expect(
      rounded(bodyCentre([part([1, 0, 0], 0.1, 0), part([-1, 2, 0], 0.1, 0)])),
    ).toEqual([0, 1, 0]);
  });
});

describe("explodeVectors", () => {
  test("left and right ribs move apart symmetrically, the distance radius plus 2 cm", () => {
    const [left, right] = explodeVectors([
      part([0.1, 0, 0], 0.12),
      part([-0.1, 0, 0], 0.12),
    ]);
    expect(rounded(left!.direction)).toEqual([1, 0, 0]);
    expect(rounded(right!.direction)).toEqual([-1, 0, 0]);
    expect(left!.distance).toBeCloseTo(0.14, 9);
    expect(right!.distance).toBeCloseTo(0.14, 9);
  });

  test("a vertebra above the centre moves up, the sacrum below moves down", () => {
    const [vertebra, sacrum] = explodeVectors([
      part([0, 0.3, -0.05]),
      part([0, -0.3, -0.05]),
    ]);
    expect(rounded(vertebra!.direction)).toEqual([0, 1, 0]);
    expect(rounded(sacrum!.direction)).toEqual([0, -1, 0]);
  });

  test("a part at the centre whose neighbours cancel moves forward", () => {
    const vectors = explodeVectors([
      part([0.2, 0, 0]),
      part([-0.2, 0, 0]),
      part([0, 0.004, 0], 0.03, 0),
    ]);
    expect(vectors[2]).toEqual({ direction: [0, 0, 1], distance: 0.05 });
  });

  test("a part at the centre takes the others' mean direction when it does not cancel", () => {
    // Body centre (0, 0.1, 0), where the last part sits; the mean of the
    // others' directions is (0, 0.12, 0), long enough to keep.
    const vectors = explodeVectors([
      part([0.3, 0, 0]),
      part([-0.3, 0, 0]),
      part([0, 0.3, 0]),
      part([0, 0.1, 0], 0.05, 0),
    ]);
    expect(rounded(vectors[3]!.direction)).toEqual([0, 1, 0]);
  });

  test("a vector the file gives wins over the rule", () => {
    const given = { direction: [0, 1, 0] as const, distance: 0.5 };
    const [first] = explodeVectors([{ ...part([0.2, 0, 0]), given }, part([-0.2, 0, 0])]);
    expect(first).toEqual(given);
  });
});

describe("explodeOffset", () => {
  const vector = { direction: [0, 0.6, 0.8] as const, distance: 0.1 };

  test("t × distance × direction", () => {
    expect(rounded(explodeOffset(vector, 0.5))).toEqual([0, 0.03, 0.04]);
  });

  test("t is clamped to 0..1 and a bad t is 0", () => {
    expect(rounded(explodeOffset(vector, 2))).toEqual([0, 0.06, 0.08]);
    expect(rounded(explodeOffset(vector, -1))).toEqual([0, 0, 0]);
    expect(rounded(explodeOffset(vector, Number.NaN))).toEqual([0, 0, 0]);
  });
});

describe("parseExplode", () => {
  test("normalises the direction", () => {
    expect(parseExplode({ direction: [0, 0, 2], distance: 0.13 })).toEqual({
      direction: [0, 0, 1],
      distance: 0.13,
    });
  });

  test("rejects missing or malformed vectors", () => {
    expect(parseExplode(undefined)).toBeNull();
    expect(parseExplode({ direction: [0, 0], distance: 0.1 })).toBeNull();
    expect(parseExplode({ direction: [0, 0, 0], distance: 0.1 })).toBeNull();
    expect(parseExplode({ direction: [0, 0, 1], distance: -1 })).toBeNull();
    expect(parseExplode({ direction: [0, "1", 0], distance: 0.1 })).toBeNull();
  });
});

describe("meshVolume", () => {
  // A unit cube, 12 outward-facing triangles.
  const positions = [
    0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1,
  ];
  const index = [
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6,
    5, 0, 4, 7, 0, 7, 3,
  ];

  test("a unit cube holds one cubic metre", () => {
    expect(meshVolume(positions, index)).toBeCloseTo(1, 9);
  });

  test("non-indexed triangles read the same", () => {
    const flat = index.flatMap((i) => positions.slice(i * 3, i * 3 + 3));
    expect(meshVolume(flat, null)).toBeCloseTo(1, 9);
  });
});
