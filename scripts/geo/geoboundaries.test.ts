import { describe, expect, test } from "bun:test";

import { matchUnit } from "./match-rate";
import { geoBoundariesUnits, polygonRings, replaceStates } from "./geoboundaries";
import { nestRings, signedArea } from "./simplify";
import { LOCATION_INDEX } from "../../infrastructure/charts/choropleth/match-location";
import { GBD_LOCATION_TABLE } from "../../packages/gbd-local/location-table";

type Position = readonly [number, number];

/** Counter-clockwise, as RFC 7946 winds an outer ring. */
const square = (x: number, y: number, size: number): Position[] => [
  [x, y],
  [x + size, y],
  [x + size, y + size],
  [x, y + size],
  [x, y],
];

const feature = (shapeISO: unknown, shapeName: unknown, rings: Position[][]) => ({
  properties: { shapeISO, shapeName },
  geometry: { type: "Polygon" as const, coordinates: rings },
});

describe("polygonRings", () => {
  test("winds outer rings clockwise and holes counter-clockwise, whatever the file does", () => {
    const outer = square(0, 0, 4);
    const hole = square(1, 1, 1);
    const [a, b] = polygonRings({ type: "Polygon", coordinates: [outer, hole] });
    expect(signedArea(a)).toBeLessThan(0);
    expect(signedArea(b)).toBeGreaterThan(0);
    const [c, d] = polygonRings({
      type: "Polygon",
      coordinates: [[...outer].reverse(), [...hole].reverse()],
    });
    expect(c).toEqual(a);
    expect(d).toEqual(b);
  });

  test("keeps each polygon of a MultiPolygon, so nesting gives them back", () => {
    const rings = polygonRings({
      type: "MultiPolygon",
      coordinates: [[square(0, 0, 1)], [square(5, 5, 1)]],
    });
    expect(rings).toHaveLength(2);
    expect(nestRings(rings)).toHaveLength(2);
  });
});

describe("geoBoundariesUnits", () => {
  test("takes the ISO 3166-2 code and the name of each feature", () => {
    const units = geoBoundariesUnits(
      { features: [feature("KE-30", "Nairobi", [square(36.7, -1.4, 0.2)])] },
      "KEN",
      "KE",
    );
    expect(
      units.map(({ country, code, name, names }) => ({ country, code, name, names })),
    ).toEqual([{ country: "KEN", code: "KE-30", name: "Nairobi", names: ["Nairobi"] }]);
  });

  test("stops on a feature without a code, with another country's code or a code twice", () => {
    const ring = [square(0, 0, 1)];
    expect(() =>
      geoBoundariesUnits({ features: [feature("None", "Somewhere", ring)] }, "KEN", "KE"),
    ).toThrow("has code none");
    expect(() =>
      geoBoundariesUnits({ features: [feature("UG-102", "Kampala", ring)] }, "KEN", "KE"),
    ).toThrow("UG-102");
    expect(() =>
      geoBoundariesUnits(
        { features: [feature("KE-01", "A", ring), feature("KE-01", "B", ring)] },
        "KEN",
        "KE",
      ),
    ).toThrow("codes twice KE-01");
  });
});

describe("replaceStates", () => {
  test("swaps one country's states and keeps the countries in order", () => {
    const states = [
      { country: "JPN", code: "JP-01" },
      { country: "KEN", code: "KE-110" },
      { country: "MEX", code: "MX-AGU" },
    ];
    const replaced = replaceStates(
      states,
      ["KEN"],
      [
        { country: "KEN", code: "KE-01" },
        { country: "KEN", code: "KE-02" },
      ],
      ["JPN", "KEN", "MEX"],
    );
    expect(replaced.map((state) => state.code)).toEqual([
      "JP-01",
      "KE-01",
      "KE-02",
      "MX-AGU",
    ]);
  });
});

describe("Kenya's counties in the committed index (#422)", () => {
  const counties = GBD_LOCATION_TABLE.flatMap(([id, , level, name, iso3, iso3166_2]) =>
    level >= 4 && iso3 === "KEN" ? [{ id, level, name, iso3, iso3166_2 }] : [],
  );

  test("each of GBD's 47 counties matches its own boundary by code", () => {
    expect(counties).toHaveLength(47);
    const matches = counties.map((county) => matchUnit(LOCATION_INDEX, county));
    expect(matches.filter((match) => match.how !== "code")).toEqual([]);
    expect(new Set(matches.map((match) => match.code)).size).toBe(47);
  });

  test("Tharaka-Nithi is found by GBD's name too", () => {
    expect(
      matchUnit(LOCATION_INDEX, {
        id: 0,
        level: 4,
        name: "Tharaka Nithi",
        iso3: "KEN",
        iso3166_2: null,
      }),
    ).toMatchObject({ how: "name", code: "KE-41" });
  });
});
