import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { type BoundaryFeature, parseBoundaries } from "./boundaries";
import { coreRings, fitView, kmToBox, longitudeRun } from "./fit-view";

const square = (
  lon: number,
  lat: number,
  size: number,
): BoundaryFeature["geometry"]["coordinates"][number] => [
  [
    [lon, lat],
    [lon + size, lat],
    [lon + size, lat + size],
    [lon, lat + size],
    [lon, lat],
  ],
];

const feature = (
  code: string,
  polygons: BoundaryFeature["geometry"]["coordinates"],
): BoundaryFeature => ({
  type: "Feature",
  properties: { code, name: code },
  geometry: { type: "MultiPolygon", coordinates: polygons },
});

// The committed Natural Earth countries (public domain), for real cases.
const COUNTRIES =
  parseBoundaries(
    JSON.parse(
      readFileSync(
        join(import.meta.dir, "../../../public/geo/natural-earth/admin0.json"),
        "utf8",
      ),
    ),
  ) ?? [];

const countries = (...codes: string[]): readonly BoundaryFeature[] =>
  COUNTRIES.filter((country) => codes.includes(country.properties.code));

const sizeOf = (view: ReturnType<typeof fitView>) =>
  view.kind === "fit"
    ? { width: view.box.maxX - view.box.minX, height: view.box.maxY - view.box.minY }
    : null;

describe("kmToBox", () => {
  test("is 0 inside and measures across the antimeridian", () => {
    const box = { west: 170, east: 180, south: -20, north: -10 };
    expect(kmToBox([175, -15], box)).toBe(0);
    // One degree of longitude on the equator is about 111 km.
    expect(kmToBox([-179, -10], box)).toBeCloseTo(109.5, 0);
  });
});

describe("longitudeRun", () => {
  test("is null for nothing", () => {
    expect(longitudeRun([])).toBeNull();
  });

  test("joins rings either side of 180 into one run", () => {
    const rings = [...square(170, 0, 5), ...square(-178, 0, 3)];
    const run = longitudeRun(rings);
    expect(run?.west).toBe(170);
    expect(run?.span).toBe(15);
  });

  test("a ring round the whole globe is the whole globe", () => {
    expect(longitudeRun([[...square(-180, -90, 360)[0]]])).toEqual({
      west: -180,
      span: 360,
    });
  });
});

describe("coreRings", () => {
  test("keeps near and sizeable land, leaves out far islands", () => {
    const country = feature("X", [
      square(0, 40, 10),
      square(12, 40, 1),
      square(0, 60, 4),
      square(60, 0, 1),
    ]);
    expect(coreRings(country).map((ring) => ring[0])).toEqual([
      [0, 40],
      [12, 40],
      [0, 60],
    ]);
  });

  test("France without its overseas regions", () => {
    const [france] = countries("FRA");
    const lons = coreRings(france).flatMap((ring) => ring.map(([lon]) => lon));
    expect(Math.min(...lons)).toBeGreaterThan(-6);
    expect(Math.max(...lons)).toBeLessThan(10);
  });
});

describe("fitView", () => {
  test("no places is the world", () => {
    expect(fitView([])).toEqual({ kind: "world", lon0: 0 });
  });

  test("every country is the world", () => {
    expect(fitView(COUNTRIES).kind).toBe("world");
  });

  test("places on three continents are the world", () => {
    expect(fitView(countries("USA", "CHN", "BRA", "AUS")).kind).toBe("world");
  });

  test("Switzerland and its neighbours fill the map", () => {
    const view = fitView(countries("CHE", "DEU", "FRA", "ITA", "AUT", "LIE"));
    expect(view.kind).toBe("fit");
    expect(view.lon0).toBeGreaterThan(0);
    expect(view.lon0).toBeLessThan(15);
    // Western Europe, not the Caribbean to Reunion: under a tenth of the world's width.
    expect(sizeOf(view)?.width).toBeLessThan(0.55);
  });

  test("Fiji across the antimeridian is centred on it", () => {
    const view = fitView(countries("FJI"));
    expect(view.kind).toBe("fit");
    expect(Math.abs(view.lon0)).toBeGreaterThan(170);
  });

  test("Russia is one run across 180, not the world", () => {
    const view = fitView(countries("RUS"));
    expect(view.kind).toBe("fit");
    expect(view.lon0).toBeGreaterThan(90);
    expect(view.lon0).toBeLessThan(120);
  });

  test("Pacific islands either side of 180 make one view", () => {
    const view = fitView(countries("FJI", "TON", "WSM", "NZL"));
    expect(view.kind).toBe("fit");
    expect(Math.abs(view.lon0)).toBeGreaterThan(170);
  });

  test("Malta and San Marino keep a minimum extent", () => {
    const malta = sizeOf(fitView(countries("MLT")));
    const sanMarino = sizeOf(fitView(countries("SMR")));
    expect(malta?.width).toBeCloseTo(sanMarino?.width ?? 0, 6);
    // At least twelve degrees of longitude (about 0.18 projected units) across.
    expect(malta?.width).toBeGreaterThan(0.18);
    expect(malta?.height).toBeGreaterThan(0.18);
  });
});
