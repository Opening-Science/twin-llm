import { describe, expect, test } from "bun:test";

import type { BoundaryFeature } from "./boundaries";
import { equalEarth } from "./projection";
import {
  centreLongitude,
  crossesEdge,
  fitBox,
  layoutMap,
  projectedBox,
  ringsBox,
  ringsPath,
} from "./map-shapes";

const square = (
  code: string,
  lon: number,
  lat: number,
  size: number,
): BoundaryFeature => ({
  type: "Feature",
  properties: { code, name: code },
  geometry: {
    type: "MultiPolygon",
    coordinates: [
      [
        [
          [lon, lat],
          [lon + size, lat],
          [lon + size, lat + size],
          [lon, lat + size],
          [lon, lat],
        ],
      ],
    ],
  },
});

describe("ringsPath", () => {
  test("writes closed rings at one decimal and drops repeats", () => {
    expect(
      ringsPath([
        [
          [0, 0],
          [10.04, 0],
          [10.01, 0.02],
          [10, 5],
        ],
      ]),
    ).toBe("M0 0L10 0L10 5Z");
  });

  test("skips rings that collapse below three points", () => {
    expect(
      ringsPath([
        [
          [0, 0],
          [0.01, 0],
          [0, 0.02],
        ],
      ]),
    ).toBe("");
  });

  test("never writes -0", () => {
    expect(
      ringsPath([
        [
          [-0.01, 1],
          [2, 1],
          [2, 3],
        ],
      ]),
    ).toBe("M0 1L2 1L2 3Z");
  });
});

describe("fitBox", () => {
  test("fits the width with padding and takes its height from the box", () => {
    expect(fitBox({ minX: 0, minY: 0, maxX: 10, maxY: 5 }, 120, 10, 1000)).toEqual({
      scale: 10,
      dx: 10,
      dy: 10,
      height: 70,
    });
  });

  test("caps the height and centres across", () => {
    expect(fitBox({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 120, 10, 60)).toEqual({
      scale: 4,
      dx: 40,
      dy: 10,
      height: 60,
    });
  });
});

describe("projectedBox", () => {
  test("is null without points", () => {
    expect(projectedBox([], 0)).toBeNull();
  });

  test("spans the projected corners", () => {
    const box = projectedBox([square("A", 0, 0, 10)], 0);
    expect(box?.minX).toBe(0);
    expect(box?.maxY).toBe(-0);
    // The widest corner is on the equator, the highest on the 10th parallel.
    expect(box?.maxX).toBe(equalEarth((10 * Math.PI) / 180, 0)[0]);
    expect(box?.minY).toBe(-equalEarth(0, (10 * Math.PI) / 180)[1]);
  });
});

describe("ringsBox", () => {
  test("is null without points and matches projectedBox", () => {
    expect(ringsBox([], 0)).toBeNull();
    const feature = square("A", 5, 5, 10);
    expect(ringsBox(feature.geometry.coordinates.flat(), 20)).toEqual(
      projectedBox([feature], 20),
    );
  });
});

describe("crossesEdge", () => {
  const ring = [
    [-1, 0],
    [1, 0],
    [1, 1],
  ] as const;

  test("a ring over the meridian opposite the centre crosses", () => {
    expect(crossesEdge(ring, 180)).toBe(true);
    expect(crossesEdge(ring, 0)).toBe(false);
  });

  test("a ring cut at 180 does not cross on a world map", () => {
    expect(
      crossesEdge(
        [
          [170, 0],
          [180, 0],
          [180, 10],
          [170, 10],
        ],
        0,
      ),
    ).toBe(false);
  });

  test("a jump the boundaries make on purpose (Antarctica's 180 to -180) is kept", () => {
    expect(
      crossesEdge(
        [
          [180, -80],
          [-180, -80],
          [-180, -90],
        ],
        30,
      ),
    ).toBe(false);
  });
});

describe("layoutMap", () => {
  const features = [square("A", 0, 0, 10), square("B", 40, 0, 10)];

  test("draws every feature, fitted to all of them", () => {
    const layout = layoutMap(features, {
      lon0: 0,
      width: 200,
      padding: 0,
      maxHeight: 999,
    });
    expect(layout.width).toBe(200);
    expect(layout.shapes.map((shape) => shape.code)).toEqual(["A", "B"]);
    expect(layout.shapes[0].d.startsWith("M0 ")).toBe(true);
    expect(layout.shapes[1].d).toContain("L200 ");
  });

  test("fits a given box and still draws the rest", () => {
    const box = projectedBox([features[0]], 0);
    const layout = layoutMap(features, {
      lon0: 0,
      width: 100,
      padding: 0,
      maxHeight: 999,
      box: box ?? undefined,
    });
    // A's box is about 0.150 wide and 0.202 tall in projected units.
    expect(layout.height).toBe(134);
    expect(layout.shapes[0].anchor[0]).toBeCloseTo(50, 5);
    expect(layout.shapes.length).toBe(2);
  });

  test("leaves out rings that cross the map's edge", () => {
    // Centred on 175, the edge is at -5: B stays, the square over 0 is left out.
    const layout = layoutMap([square("A", -10, 0, 10), square("B", 170, 0, 10)], {
      lon0: 175,
      width: 100,
      padding: 0,
      maxHeight: 999,
    });
    expect(layout.shapes.map((shape) => shape.d === "")).toEqual([true, false]);
  });

  test("an empty set has no height", () => {
    expect(layoutMap([], { lon0: 0, width: 100, padding: 0, maxHeight: 50 })).toEqual({
      width: 100,
      height: 0,
      shapes: [],
    });
  });
});

describe("centreLongitude", () => {
  test("weights ring centres by area", () => {
    // (15 × 900 + 95 × 100) / 1000
    expect(centreLongitude([square("A", 0, 0, 30), square("B", 90, 0, 10)])).toBe(23);
  });

  test("is 0 for nothing", () => {
    expect(centreLongitude([])).toBe(0);
  });
});
