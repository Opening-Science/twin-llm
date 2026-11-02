import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { boundaryFile, parseBoundaries } from "./boundaries";
import { layersOf, LOCATION_INDEX, subnationalCountries } from "./match-location";

const DATA = join(import.meta.dir, "../../../public/geo/natural-earth");

describe("boundaryFile", () => {
  test("names the countries file or one country's states", () => {
    expect(boundaryFile(null)).toBe("admin0.json");
    expect(boundaryFile("NGA")).toBe("admin1/NGA.json");
    expect(boundaryFile("NGA", null)).toBe("admin1/NGA.json");
  });

  test("names a country's upper layer file (#421)", () => {
    expect(boundaryFile("GBR", "nations")).toBe("admin1/GBR-nations.json");
    expect(boundaryFile("GBR", "regions")).toBe("admin1/GBR-regions.json");
    expect(boundaryFile(null, "nations")).toBe("admin0.json");
  });
});

describe("parseBoundaries", () => {
  test("refuses anything but a collection of MultiPolygons", () => {
    expect(parseBoundaries({ type: "FeatureCollection", features: [{}] })).toBeNull();
    expect(parseBoundaries(null)).toBeNull();
  });

  test("keeps code, name and rings", () => {
    const feature = {
      type: "Feature",
      properties: { code: "XXX", name: "Somewhere" },
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 0],
            ],
          ],
        ],
      },
    };
    expect(parseBoundaries({ type: "FeatureCollection", features: [feature] })).toEqual([
      feature,
    ]);
  });
});

describe("committed boundaries", () => {
  const read = (file: string) =>
    parseBoundaries(JSON.parse(readFileSync(join(DATA, file), "utf8")));

  test("the countries file parses, with one feature per index country", () => {
    const codes = read("admin0.json")?.map((feature) => feature.properties.code);
    expect(codes).toEqual(LOCATION_INDEX.countries.map((country) => country.code));
    expect(new Set(codes).size).toBe(codes?.length ?? -1);
  });

  test("every country with states has a file per layer whose codes match the index", () => {
    const layered = subnationalCountries(LOCATION_INDEX).flatMap((country) =>
      layersOf(LOCATION_INDEX, country).map((layer) => ({ country, layer })),
    );
    const files = readdirSync(join(DATA, "admin1")).toSorted();
    expect(files).toEqual(
      layered
        .map(({ country, layer }) =>
          boundaryFile(country, layer).replace(/^admin1\//, ""),
        )
        .toSorted(),
    );
    for (const { country, layer } of layered) {
      const codes = read(boundaryFile(country, layer))?.map(
        (feature) => feature.properties.code,
      );
      expect(codes).toEqual(
        LOCATION_INDEX.states
          .filter((state) => state.country === country && (state.layer ?? null) === layer)
          .map((state) => state.code),
      );
      if (layer !== null) expect(new Set(codes).size).toBe(codes?.length ?? -1);
    }
  });

  test("the United Kingdom has its nations and its 12 regions as layers (#421)", () => {
    expect(layersOf(LOCATION_INDEX, "GBR")).toEqual([null, "nations", "regions"]);
    expect(read("admin1/GBR-nations.json")?.map((f) => f.properties.name)).toEqual([
      "England",
      "Northern Ireland",
      "Scotland",
      "Wales",
    ]);
    expect(read("admin1/GBR-regions.json")?.length).toBe(12);
  });

  test("stays within the size budget: under 2.5 MB in all", () => {
    const sizes = [
      statSync(join(DATA, "admin0.json")).size,
      ...readdirSync(join(DATA, "admin1")).map(
        (file) => statSync(join(DATA, "admin1", file)).size,
      ),
    ];
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBeLessThan(2_500_000);
  });
});
