import { describe, expect, test } from "bun:test";

import { dissolveRings } from "./dissolve";
import type { Ring } from "./shapefile";
import { signedArea } from "./simplify";

/** A clockwise unit square with its lower left corner at (x, y), as shapefile outer rings run. */
const square = (x: number, y: number): Ring => [
  [x, y],
  [x, y + 1],
  [x + 1, y + 1],
  [x + 1, y],
  [x, y],
];

const area = (rings: readonly Ring[]) =>
  rings.reduce((sum, ring) => sum + signedArea(ring), 0);

describe("dissolveRings", () => {
  test("two squares sharing an edge become one ring with the same area and winding", () => {
    const rings = dissolveRings([square(0, 0), square(1, 0)]);
    expect(rings).toHaveLength(1);
    expect(rings[0]?.[0]).toEqual(rings[0]?.at(-1));
    expect(area(rings)).toBeCloseTo(area([square(0, 0), square(1, 0)]));
    const ring = rings[0] ?? [];
    const innerEdges = ring
      .slice(1)
      .filter(([x], at) => x === 1 && (ring[at] as readonly number[])[0] === 1);
    expect(innerEdges).toHaveLength(0);
  });

  test("a ring of four squares around nothing keeps no inner edge", () => {
    const rings = dissolveRings([square(0, 0), square(1, 0), square(0, 1), square(1, 1)]);
    expect(rings).toHaveLength(1);
    expect(rings[0]?.some(([x, y]) => x === 1 && y === 1)).toBe(false);
  });

  test("units that do not touch stay apart", () => {
    expect(dissolveRings([square(0, 0), square(5, 5)])).toHaveLength(2);
  });

  test("a border not shared vertex for vertex is kept", () => {
    const shifted: Ring = [
      [1, 0],
      [1, 0.5],
      [1, 1],
      [2, 1],
      [2, 0],
      [1, 0],
    ];
    const rings = dissolveRings([square(0, 0), shifted]);
    expect(rings.flat().some(([x]) => x === 1)).toBe(true);
  });
});
