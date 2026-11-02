import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  boundaryCredit,
  boundaryFile,
  GEOBOUNDARIES_COUNTRIES,
  parseBoundaries,
} from "./boundaries";
import { LOCATION_INDEX, subnationalCountries } from "./match-location";

const GEO = join(import.meta.dir, "../../../public/geo");
const DATA = join(GEO, "natural-earth");
const GEOBOUNDARIES = join(GEO, "geoboundaries");

describe("boundaryFile", () => {
  test("names the countries file or one country's states", () => {
    expect(boundaryFile(null)).toBe("natural-earth/admin0.json");
    expect(boundaryFile("NGA")).toBe("natural-earth/admin1/NGA.json");
  });

  test("names the geoBoundaries file for Kenya's counties", () => {
    expect(boundaryFile("KEN")).toBe("geoboundaries/admin1/KEN.json");
  });
});

describe("boundaryCredit", () => {
  test("credits geoBoundaries under CC BY 4.0 on a map of Kenya's counties", () => {
    expect(boundaryCredit("KEN")?.text).toBe("Boundaries: geoBoundaries (CC BY 4.0)");
    expect(boundaryCredit("KEN")?.url).toBe("https://www.geoboundaries.org");
  });

  test("asks for no credit on Natural Earth's public domain files", () => {
    expect(boundaryCredit(null)).toBeNull();
    expect(boundaryCredit("NGA")).toBeNull();
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

  test("every country with states has one file, from its source, whose codes match the index", () => {
    const countries = subnationalCountries(LOCATION_INDEX);
    expect(readdirSync(join(DATA, "admin1")).toSorted()).toEqual(
      countries
        .filter((code) => !GEOBOUNDARIES_COUNTRIES.includes(code))
        .toSorted()
        .map((code) => `${code}.json`),
    );
    expect(readdirSync(join(GEOBOUNDARIES, "admin1")).toSorted()).toEqual(
      countries
        .filter((code) => GEOBOUNDARIES_COUNTRIES.includes(code))
        .toSorted()
        .map((code) => `${code}.json`),
    );
    for (const code of countries) {
      const features = parseBoundaries(
        JSON.parse(readFileSync(join(GEO, boundaryFile(code)), "utf8")),
      );
      expect(features?.map((feature) => feature.properties.code)).toEqual(
        LOCATION_INDEX.states
          .filter((state) => state.country === code)
          .map((state) => state.code),
      );
    }
  });

  test("stays within the size budget: under 2.5 MB in all", () => {
    const sizes = [
      statSync(join(DATA, "admin0.json")).size,
      ...[DATA, GEOBOUNDARIES].flatMap((folder) =>
        readdirSync(join(folder, "admin1")).map(
          (file) => statSync(join(folder, "admin1", file)).size,
        ),
      ),
    ];
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBeLessThan(2_500_000);
  });
});
