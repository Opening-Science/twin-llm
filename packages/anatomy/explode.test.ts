import { describe, expect, test } from "bun:test";

import {
  bodyCentre,
  explodeOffset,
  explodeVectors,
  parseExplode,
  type ExplodeInput,
} from "./explode";

const part = (centre: readonly [number, number, number]): ExplodeInput => ({
  centre,
  given: null,
});

const rounded = (values: readonly number[]): readonly number[] =>
  values.map((value) => Math.round(value * 1e6) / 1e6 + 0);

describe("bodyCentre", () => {
  test("is the middle of the centres' extent, so a heavy end does not pull it", () => {
    expect(
      rounded(bodyCentre([part([0, -0.3, 0]), part([0, -0.28, 0]), part([0, 0.3, 0.1])])),
    ).toEqual([0, 0, 0.05]);
  });

  test("nothing at all sits at the origin", () => {
    expect(bodyCentre([])).toEqual([0, 0, 0]);
  });
});

describe("explodeVectors", () => {
  test("left and right ribs move apart symmetrically, 0.8 of their distance plus 2 cm", () => {
    const [left, right] = explodeVectors([part([0.1, 0, 0]), part([-0.1, 0, 0])]);
    expect(rounded(left!.direction)).toEqual([1, 0, 0]);
    expect(rounded(right!.direction)).toEqual([-1, 0, 0]);
    expect(left!.distance).toBeCloseTo(0.1, 9);
    expect(right!.distance).toBeCloseTo(0.1, 9);
  });

  test("neighbouring vertebrae come apart: the gap grows with the spread", () => {
    const spine = [0.3, 0.27, 0.24, -0.24, -0.27, -0.3].map((y) => part([0, y, -0.05]));
    const vectors = explodeVectors(spine);
    const moved = spine.map(
      (vertebra, index) => vertebra.centre[1] + explodeOffset(vectors[index]!, 1)[1],
    );
    // Built 3 cm apart; at full spread 1.8 × 3 = 5.4 cm apart.
    expect(rounded([moved[0]! - moved[1]!, moved[1]! - moved[2]!])).toEqual([
      0.054, 0.054,
    ]);
    expect(vectors[0]!.direction).toEqual([0, 1, 0]);
    expect(vectors[5]!.direction).toEqual([0, -1, 0]);
  });

  test("a part at the centre whose neighbours cancel moves forward by the clearance", () => {
    const vectors = explodeVectors([
      part([0.2, 0, 0]),
      part([-0.2, 0, 0]),
      part([0, 0.004, 0]),
      part([0, -0.004, 0]),
    ]);
    expect(vectors[2]!.direction).toEqual([0, 0, 1]);
    expect(vectors[2]!.distance).toBeCloseTo(0.0232, 9);
  });

  test("a part at the centre takes the others' mean direction when it does not cancel", () => {
    // Centre (0, 0.1, 0), where the last part sits; the others' mean
    // direction is (0, 0.12, 0), long enough to keep.
    const vectors = explodeVectors([
      part([0.3, 0, 0]),
      part([-0.3, 0, 0]),
      part([0, 0.2, 0]),
      part([0, 0.1, 0]),
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
