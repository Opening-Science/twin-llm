import { describe, expect, test } from "bun:test";

import type { LocationIndex } from "@/infrastructure/charts/choropleth/match-location";

import type { LocationEstimate } from "./estimate-ledger";
import { buildMapSpec, estimateKey, estimateLabel } from "./map-view";

/** Made-up estimates; the shape follows `gbd_population` rows. */
const INDEX: LocationIndex = {
  version: "test",
  countries: [
    { code: "NGA", name: "Nigeria", names: [] },
    { code: "GHA", name: "Ghana", names: [] },
  ],
  states: [
    { code: "NG-LA", country: "NGA", name: "Lagos", names: ["Lagos State"] },
    { code: "NG-KN", country: "NGA", name: "Kano", names: [] },
  ],
};

const row = (
  location: string,
  value: number,
  extra: Partial<LocationEstimate> = {},
): LocationEstimate => ({
  location,
  value,
  lower: value - 1,
  upper: value + 1,
  unit: "per 100,000",
  measure: "prevalence",
  cause: "Diabetes mellitus",
  year: "2021",
  sex: "both",
  age: "age_standardized",
  source: "IHME GBD 2021",
  ...extra,
});

describe("estimateLabel", () => {
  test("names the estimate from its own fields", () => {
    expect(estimateLabel(row("Nigeria", 1))).toBe(
      "Prevalence, Diabetes mellitus, 2021, both sexes, age-standardised",
    );
    expect(
      estimateLabel({ location: "X", value: 1, lower: null, upper: null, unit: "" }),
    ).toBe("Estimate");
    expect(estimateLabel(row("X", 1, { measure: "new_cases", sex: "other_sex" }))).toBe(
      "new cases, Diabetes mellitus, 2021, other sex, age-standardised",
    );
  });
});

describe("estimateKey", () => {
  test("differs when any part of the estimate does", () => {
    expect(estimateKey(row("A", 1))).toBe(estimateKey(row("B", 2)));
    expect(estimateKey(row("A", 1))).not.toBe(estimateKey(row("A", 1, { year: "2020" })));
  });
});

describe("buildMapSpec", () => {
  test("refuses without estimates", () => {
    expect(buildMapSpec(INDEX, [], { level: "world", country: null })).toEqual({
      code: "ESTIMATES_REQUIRED",
      error:
        "map.choropleth maps population estimates this turn looked up; look them up first, then call show_view again",
    });
  });

  test("maps countries from the rows' own numbers and lists the rest", () => {
    const built = buildMapSpec(
      INDEX,
      [
        { tool: "gbd_population", callId: "c1", rows: [row("Nigeria", 5)] },
        {
          tool: "gbd_population",
          callId: "c2",
          rows: [row("Ghana", 3), row("Global", 4)],
        },
      ],
      { level: "world", country: null },
    );
    expect(built).toEqual({
      spec: {
        level: "world",
        country: null,
        measure: "prevalence",
        label: "Prevalence, Diabetes mellitus, 2021, both sexes, age-standardised",
        unit: "per 100,000",
        source: "IHME GBD 2021",
        subject: null,
        regions: [
          {
            code: "NGA",
            name: "Nigeria",
            location: "Nigeria",
            value: 5,
            lower: 4,
            upper: 6,
          },
          { code: "GHA", name: "Ghana", location: "Ghana", value: 3, lower: 2, upper: 4 },
        ],
        unmatched: ["Global"],
        n: 3,
      },
      place: "by country",
      callIds: ["c1", "c2"],
    });
  });

  test("draws only the latest estimate; a repeated place keeps its latest row", () => {
    const built = buildMapSpec(
      INDEX,
      [
        { tool: "t", callId: "a", rows: [row("Nigeria", 9, { year: "2019" })] },
        { tool: "t", callId: "b", rows: [row("Nigeria", 5), row("Ghana", 3)] },
        { tool: "t", callId: "c", rows: [row("NGA", 6)] },
      ],
      { level: "region", country: null },
    );
    expect(
      "spec" in built ? built.spec.regions.map((r) => [r.code, r.value]) : built,
    ).toEqual([
      ["NGA", 6],
      ["GHA", 3],
    ]);
    expect("spec" in built ? [built.place, built.callIds] : built).toEqual([
      "selected countries",
      ["b", "c"],
    ]);
  });

  test("a country's states, matched by name or code", () => {
    const built = buildMapSpec(
      INDEX,
      [
        {
          tool: "t",
          callId: "s",
          rows: [row("Lagos State", 7, { unit: "" }), row("NG-KN", 2, { unit: "" })],
        },
      ],
      { level: "country", country: "NGA" },
    );
    expect("spec" in built ? built.spec.regions.map((r) => r.code) : built).toEqual([
      "NG-LA",
      "NG-KN",
    ]);
    expect(
      "spec" in built ? [built.spec.country, built.place, built.spec.unit] : built,
    ).toEqual(["NGA", "Nigeria, by state or province", null]);
  });

  test("refuses a country level without a country, or without boundaries", () => {
    const recorded = [{ tool: "t", callId: "x", rows: [row("Lagos", 1)] }];
    expect(buildMapSpec(INDEX, recorded, { level: "country", country: null })).toEqual({
      code: "COUNTRY_REQUIRED",
      error: "level country needs country: an ISO 3166-1 alpha-3 code such as NGA",
    });
    expect(buildMapSpec(INDEX, recorded, { level: "country", country: "GHA" })).toEqual({
      code: "NO_SUBNATIONAL_BOUNDARIES",
      error: "no state or province boundaries for this country; these have them: NGA",
    });
  });

  test("refuses when no location is a place at this level", () => {
    expect(
      buildMapSpec(INDEX, [{ tool: "t", callId: "g", rows: [row("Global", 1)] }], {
        level: "world",
        country: null,
      }),
    ).toEqual({
      code: "NOTHING_TO_MAP",
      error:
        "none of the estimate's locations is a place at this level, so nothing is drawn",
    });
  });
});
