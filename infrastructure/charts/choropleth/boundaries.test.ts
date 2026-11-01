import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { boundaryFile, parseBoundaries } from "./boundaries";
import { LOCATION_INDEX, subnationalCountries } from "./match-location";

const DATA = join(import.meta.dir, "../../../public/geo/natural-earth");

describe("boundaryFile", () => {
  test("names the countries file or one country's states", () => {
    expect(boundaryFile(null)).toBe("admin0.json");
    expect(boundaryFile("NGA")).toBe("admin1/NGA.json");
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

  test("every country with states has a file whose codes match the index", () => {
    const files = readdirSync(join(DATA, "admin1")).toSorted();
    expect(files).toEqual(
      subnationalCountries(LOCATION_INDEX)
        .toSorted()
        .map((code) => `${code}.json`),
    );
    for (const code of subnationalCountries(LOCATION_INDEX)) {
      expect(
        read(`admin1/${code}.json`)?.map((feature) => feature.properties.code),
      ).toEqual(
        LOCATION_INDEX.states
          .filter((state) => state.country === code)
          .map((state) => state.code),
      );
    }
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
