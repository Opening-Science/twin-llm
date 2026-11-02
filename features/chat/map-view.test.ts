import { describe, expect, test } from "bun:test";

import type { LocationIndex } from "@/infrastructure/charts/choropleth/match-location";

import type { LocationEstimate } from "./estimate-ledger";
import {
  buildMapSpec,
  estimateKey,
  estimateLabel,
  matchEstimate,
  pickLayer,
  statesCountry,
} from "./map-view";

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
  test("names HALE at birth without a cause (#394)", () => {
    expect(
      estimateLabel({
        location: "Switzerland",
        value: 70.5,
        lower: null,
        upper: null,
        unit: "years",
        measure: "hale",
        year: "2023",
        sex: "both",
        age: "at_birth",
      }),
    ).toBe("Healthy life expectancy (HALE), 2023, both sexes, at birth");
  });

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

  test("refuses a country level without states of one country, or without boundaries", () => {
    const recorded = [{ tool: "t", callId: "x", rows: [row("Ghana", 1)] }];
    expect(buildMapSpec(INDEX, recorded, { level: "country", country: null })).toEqual({
      code: "STATES_REQUIRED",
      error:
        "level country maps the states of one country; look up estimates for one country's states first (gbd_estimate: children_of the country)",
    });
    expect(buildMapSpec(INDEX, recorded, { level: "country", country: "GHA" })).toEqual({
      code: "NO_SUBNATIONAL_BOUNDARIES",
      error: "no state or province boundaries for this country; these have them: NGA",
    });
    const polish = [
      {
        tool: "gbd_estimate",
        callId: "p",
        rows: [
          row("Mazowieckie", 1, { iso3: "POL", iso3166_2: null, level: "subnational" }),
        ],
      },
    ];
    expect(
      buildMapSpec(INDEX, polish, { level: "country", country: null }),
    ).toMatchObject({
      code: "NO_SUBNATIONAL_BOUNDARIES",
    });
  });

  test("finds the country of states looked up by name", () => {
    const recorded = [{ tool: "t", callId: "x", rows: [row("Lagos State", 1)] }];
    const built = buildMapSpec(INDEX, recorded, { level: "country", country: null });
    if ("code" in built) throw new Error(built.error);
    expect(built.spec.country).toBe("NGA");
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

/** Made-up `gbd_estimate` rows: GBD ids and ISO codes from the location map. */
const GBD_INDEX: LocationIndex = {
  version: "test",
  countries: [
    { code: "USA", name: "United States of America", names: ["United States"] },
    { code: "GEO", name: "Georgia", names: [] },
    { code: "CHE", name: "Switzerland", names: [] },
  ],
  states: [
    { code: "US-GA", country: "USA", name: "Georgia", names: [] },
    { code: "US-AL", country: "USA", name: "Alabama", names: [] },
    { code: "US-AK", country: "USA", name: "Alaska", names: [] },
  ],
};

const gbdRow = (
  location: string,
  value: number,
  place: Pick<LocationEstimate, "location_id" | "iso3" | "iso3166_2" | "level">,
): LocationEstimate => ({
  ...row(location, value, { metric: "rate", source: "IHME GBD 2023" }),
  ...place,
});

const GEORGIA_STATE = gbdRow("Georgia", 210, {
  location_id: 533,
  iso3: "USA",
  iso3166_2: "US-GA",
  level: "subnational",
});
const GEORGIA_COUNTRY = gbdRow("Georgia", 300, {
  location_id: 35,
  iso3: "GEO",
  iso3166_2: null,
  level: "country",
});
const ALABAMA = gbdRow("Alabama", 220, {
  location_id: 523,
  iso3: "USA",
  iso3166_2: "US-AL",
  level: "subnational",
});
const SWISS = gbdRow("Schweiz", 100, {
  location_id: 94,
  iso3: "CHE",
  iso3166_2: null,
  level: "country",
});

describe("matchEstimate", () => {
  const states = { level: "states", country: "USA" } as const;
  const countries = { level: "countries" } as const;

  test("matches by ISO code before the name", () => {
    expect(matchEstimate(GBD_INDEX, SWISS, countries)).toEqual({
      code: "CHE",
      name: "Switzerland",
    });
    expect(matchEstimate(GBD_INDEX, GEORGIA_STATE, states)).toEqual({
      code: "US-GA",
      name: "Georgia",
    });
  });

  test("falls back to the name when the code has no boundary", () => {
    const renamed = { ...ALABAMA, iso3166_2: "US-XX" };
    expect(matchEstimate(GBD_INDEX, renamed, states)?.code).toBe("US-AL");
    const noCode = { ...ALABAMA, iso3166_2: null };
    expect(matchEstimate(GBD_INDEX, noCode, states)?.code).toBe("US-AL");
  });

  test("never matches a place at another level or in another country", () => {
    expect(matchEstimate(GBD_INDEX, GEORGIA_STATE, countries)).toBeNull();
    expect(matchEstimate(GBD_INDEX, GEORGIA_COUNTRY, states)).toBeNull();
    expect(
      matchEstimate(GBD_INDEX, { ...GEORGIA_STATE, iso3: "MEX" }, states),
    ).toBeNull();
    expect(
      matchEstimate(GBD_INDEX, { ...SWISS, level: "aggregate" }, countries),
    ).toBeNull();
  });

  test("matches rows without a level by name, as before", () => {
    expect(matchEstimate(GBD_INDEX, row("Georgia", 1), countries)?.code).toBe("GEO");
  });
});

describe("statesCountry", () => {
  const index: LocationIndex = {
    ...GBD_INDEX,
    states: [
      ...GBD_INDEX.states,
      { code: "MX-SON", country: "MEX", name: "Sonora", names: [] },
    ],
  };
  const SONORA = gbdRow("Sonora", 5, {
    location_id: 4669,
    iso3: "MEX",
    iso3166_2: "MX-SON",
    level: "subnational",
  });

  test("is the country with boundaries most rows are states of", () => {
    expect(statesCountry(index, [GEORGIA_STATE, ALABAMA, GEORGIA_COUNTRY])).toBe("USA");
    expect(statesCountry(index, [GEORGIA_STATE, ALABAMA, SONORA])).toBe("USA");
    expect(statesCountry(index, [row("Alaska", 1)])).toBe("USA");
  });

  test("is null when no row is a state, or two countries tie", () => {
    expect(statesCountry(index, [GEORGIA_COUNTRY])).toBeNull();
    expect(statesCountry(index, [ALABAMA, SONORA])).toBeNull();
  });
});

describe("buildMapSpec with gbd_estimate rows", () => {
  const recorded = [
    {
      tool: "gbd_estimate",
      callId: "e1",
      rows: [GEORGIA_COUNTRY, GEORGIA_STATE, ALABAMA],
    },
  ];

  test("draws a country's states by ISO 3166-2 and lists the rest", () => {
    const built = buildMapSpec(GBD_INDEX, recorded, { level: "country", country: "USA" });
    if ("code" in built) throw new Error(built.error);
    expect(built.spec.regions.map((region) => [region.code, region.value])).toEqual([
      ["US-GA", 210],
      ["US-AL", 220],
    ]);
    expect(built.spec.unmatched).toEqual(["Georgia"]);
    expect(built.spec.n).toBe(3);
    expect(built.place).toBe("United States of America, by state or province");
  });

  test("takes the states' country when level country names none", () => {
    const built = buildMapSpec(GBD_INDEX, recorded, { level: "country", country: null });
    if ("code" in built) throw new Error(built.error);
    expect(built.spec.country).toBe("USA");
  });

  test("keeps two places with one name apart at country level", () => {
    const built = buildMapSpec(GBD_INDEX, recorded, { level: "world", country: null });
    if ("code" in built) throw new Error(built.error);
    expect(built.spec.regions.map((region) => [region.code, region.value])).toEqual([
      ["GEO", 300],
    ]);
    expect(built.spec.unmatched).toEqual(["Georgia", "Alabama"]);
  });
});

/** A made-up UK with local units, nations and regions as layers (#421). */
const UK_INDEX: LocationIndex = {
  version: "test",
  countries: [{ code: "GBR", name: "United Kingdom", names: [] }],
  states: [
    { code: "GB-LDS", country: "GBR", name: "Leeds", names: [] },
    { code: "GB-YOR", country: "GBR", name: "York", names: [] },
    { code: "GB-ENG", country: "GBR", layer: "nations", name: "England", names: [] },
    { code: "GB-SCT", country: "GBR", layer: "nations", name: "Scotland", names: [] },
    {
      code: "GBD-4620",
      country: "GBR",
      layer: "regions",
      name: "Yorkshire and the Humber",
      names: [],
    },
    {
      code: "GBD-4624",
      country: "GBR",
      layer: "regions",
      name: "Greater London",
      names: ["London"],
    },
    { code: "GB-SCT", country: "GBR", layer: "regions", name: "Scotland", names: [] },
  ],
};

const ukRow = (location: string, value: number, iso3166_2: string | null = null) =>
  row(location, value, { level: "subnational", iso3: "GBR", iso3166_2 });

describe("UK nations and regions (#421)", () => {
  const nations = [ukRow("England", 1, "GB-ENG"), ukRow("Scotland", 2, "GB-SCT")];
  const regions = [
    ukRow("Yorkshire and the Humber", 3),
    ukRow("Greater London", 4),
    ukRow("Scotland", 5, "GB-SCT"),
  ];
  const local = [ukRow("Leeds", 6), ukRow("York", 7)];

  test("pickLayer takes the layer most rows match, the states on a tie", () => {
    expect(pickLayer(UK_INDEX, nations, "GBR")).toBe("nations");
    expect(pickLayer(UK_INDEX, regions, "GBR")).toBe("regions");
    expect(pickLayer(UK_INDEX, local, "GBR")).toBeNull();
    expect(pickLayer(UK_INDEX, [], "GBR")).toBeNull();
    expect(pickLayer(INDEX, [row("Lagos", 1)], "NGA")).toBeNull();
  });

  test("statesCountry counts rows on any layer", () => {
    expect(statesCountry(UK_INDEX, nations)).toBe("GBR");
  });

  test("draws GBD's nations on the nations file", () => {
    const built = buildMapSpec(UK_INDEX, [{ tool: "t", callId: "c", rows: nations }], {
      level: "country",
      country: null,
    });
    if ("code" in built) throw new Error(built.error);
    expect(built.spec.layer).toBe("nations");
    expect(built.spec.regions.map((region) => region.code)).toEqual(["GB-ENG", "GB-SCT"]);
    expect(built.place).toBe("United Kingdom, by nation");
  });

  test("draws England's regions with Scotland on the regions file, other levels listed", () => {
    const rows = [...regions, ukRow("Leeds", 8)];
    const built = buildMapSpec(UK_INDEX, [{ tool: "t", callId: "c", rows }], {
      level: "country",
      country: "GBR",
    });
    if ("code" in built) throw new Error(built.error);
    expect(built.spec.layer).toBe("regions");
    expect(built.spec.regions.map((region) => region.code)).toEqual([
      "GBD-4620",
      "GBD-4624",
      "GB-SCT",
    ]);
    expect(built.spec.unmatched).toEqual(["Leeds"]);
    expect(built.place).toBe("United Kingdom, by region");
  });

  test("local units keep the states file and no layer in the spec", () => {
    const built = buildMapSpec(UK_INDEX, [{ tool: "t", callId: "c", rows: local }], {
      level: "country",
      country: "GBR",
    });
    if ("code" in built) throw new Error(built.error);
    expect("layer" in built.spec).toBe(false);
    expect(built.place).toBe("United Kingdom, by state or province");
  });
});
