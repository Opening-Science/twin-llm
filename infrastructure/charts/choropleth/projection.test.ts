import { describe, expect, test } from "bun:test";

import { equalEarth, projectLonLat, wrapLongitude } from "./projection";

const DEG = Math.PI / 180;

/** Shoelace area of a projected outline. */
const area = (points: readonly (readonly [number, number])[]): number =>
  Math.abs(
    points.reduce((sum, [x, y], index) => {
      const [nx, ny] = points[(index + 1) % points.length];
      return sum + x * ny - nx * y;
    }, 0) / 2,
  );

describe("equalEarth", () => {
  test("puts the origin at the origin", () => {
    expect(equalEarth(0, 0)).toEqual([0, 0]);
  });

  test("matches the published extent: equator half-width and pole height", () => {
    const [x] = equalEarth(Math.PI, 0);
    const [, y] = equalEarth(0, Math.PI / 2);
    expect(x).toBeCloseTo(2.706629983696, 10);
    expect(y).toBeCloseTo(1.317362759157, 10);
    // The paper gives the width to height ratio as about 2.05 to 1.
    expect(x / y).toBeCloseTo(2.0546, 4);
  });

  test("is equal-area: the whole unit sphere projects to 4π", () => {
    const steps = 2000;
    const east = Array.from({ length: steps + 1 }, (_, index) =>
      equalEarth(Math.PI, (-90 + (180 * index) / steps) * DEG),
    );
    const west = east.map(([x, y]) => [-x, y] as const).reverse();
    expect(area([...east, ...west])).toBeCloseTo(4 * Math.PI, 4);
  });

  test("a band from the equator to 30°N covers π of the unit sphere", () => {
    const steps = 2000;
    const along = (from: number, to: number, at: (t: number) => [number, number]) =>
      Array.from({ length: steps + 1 }, (_, i) => at(from + ((to - from) * i) / steps));
    // Equator east, the 180° meridian north, 30°N west, the -180° meridian south.
    const band = [
      ...along(-180, 180, (lon) => [lon, 0]),
      ...along(0, 30, (lat) => [180, lat]),
      ...along(180, -180, (lon) => [lon, 30]),
      ...along(30, 0, (lat) => [-180, lat]),
    ].map(([lon, lat]) => equalEarth(lon * DEG, lat * DEG));
    // 2π·sin(30°) = π.
    expect(area(band)).toBeCloseTo(Math.PI, 4);
  });
});

describe("wrapLongitude", () => {
  test("centres on lon0 and wraps past the far side", () => {
    expect(wrapLongitude(10, 0)).toBe(10);
    expect(wrapLongitude(175, -100)).toBe(-85);
    expect(wrapLongitude(-170, 100)).toBe(90);
  });

  test("keeps the antimeridian edges where they are", () => {
    expect(wrapLongitude(180, 0)).toBe(180);
    expect(wrapLongitude(-180, 0)).toBe(-180);
  });
});

describe("projectLonLat", () => {
  test("flips y so north is up on screen", () => {
    const [x, y] = projectLonLat(10, 45);
    expect(x).toBeCloseTo(0.128872722123, 10);
    expect(y).toBeCloseTo(-0.860231085522, 10);
  });

  test("centres on lon0", () => {
    expect(projectLonLat(-100, 0, -100)).toEqual([0, -0]);
  });
});
