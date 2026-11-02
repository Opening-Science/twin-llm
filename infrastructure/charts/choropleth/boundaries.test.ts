import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  boundaryCredit,
  boundaryFile,
  GEOBOUNDARIES_COUNTRIES,
  parseBoundaries,
  type BoundaryFeature,
} from "./boundaries";
import { layersOf, LOCATION_INDEX, subnationalCountries } from "./match-location";

const GEO = join(import.meta.dir, "../../../public/geo");
const DATA = join(GEO, "natural-earth");
const GEOBOUNDARIES = join(GEO, "geoboundaries");

describe("boundaryFile", () => {
  test("names the countries file or one country's states", () => {
    expect(boundaryFile(null)).toBe("natural-earth/admin0.json");
    expect(boundaryFile("NGA")).toBe("natural-earth/admin1/NGA.json");
    expect(boundaryFile("NGA", null)).toBe("natural-earth/admin1/NGA.json");
  });

  test("names a country's upper layer file (#421)", () => {
    expect(boundaryFile("GBR", "nations")).toBe("natural-earth/admin1/GBR-nations.json");
    expect(boundaryFile("GBR", "regions")).toBe("natural-earth/admin1/GBR-regions.json");
    expect(boundaryFile(null, "nations")).toBe("natural-earth/admin0.json");
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
    const feature: BoundaryFeature = {
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
    parseBoundaries(JSON.parse(readFileSync(join(GEO, file), "utf8")));

  test("the countries file parses, with one feature per index country", () => {
    const codes = read(boundaryFile(null))?.map((feature) => feature.properties.code);
    expect(codes).toEqual(LOCATION_INDEX.countries.map((country) => country.code));
    expect(new Set(codes).size).toBe(codes?.length ?? -1);
  });

  test("every country with states has a file per layer, from its source, whose codes match the index", () => {
    const layered = subnationalCountries(LOCATION_INDEX).flatMap((country) =>
      layersOf(LOCATION_INDEX, country).map((layer) => ({ country, layer })),
    );
    const listed = (folder: string) =>
      readdirSync(join(GEO, folder, "admin1"))
        .map((file) => `${folder}/admin1/${file}`)
        .toSorted();
    expect([...listed("natural-earth"), ...listed("geoboundaries")].toSorted()).toEqual(
      layered.map(({ country, layer }) => boundaryFile(country, layer)).toSorted(),
    );
    expect(listed("geoboundaries")).toEqual(
      GEOBOUNDARIES_COUNTRIES.map((code) => boundaryFile(code)).toSorted(),
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
    expect(read(boundaryFile("GBR", "nations"))?.map((f) => f.properties.name)).toEqual([
      "England",
      "Northern Ireland",
      "Scotland",
      "Wales",
    ]);
    expect(read(boundaryFile("GBR", "regions"))?.length).toBe(12);
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
