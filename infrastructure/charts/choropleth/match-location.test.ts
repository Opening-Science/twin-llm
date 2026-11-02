import { describe, expect, test } from "bun:test";

import {
  countryName,
  layersOf,
  LOCATION_INDEX,
  type LocationIndex,
  matchLocation,
  normalizeName,
  subnationalCountries,
} from "./match-location";

const INDEX: LocationIndex = {
  version: "test",
  countries: [
    { code: "CIV", name: "Côte d'Ivoire", names: ["Ivory Coast"] },
    { code: "NER", name: "Niger", names: [] },
    { code: "NGA", name: "Nigeria", names: ["Federal Republic of Nigeria"] },
  ],
  states: [
    { code: "NG-NI", country: "NGA", name: "Niger", names: ["Niger State"] },
    { code: "NG-LA", country: "NGA", name: "Lagos", names: [] },
  ],
};

describe("normalizeName", () => {
  test("drops case, accents, punctuation, a leading the and a trailing kind", () => {
    expect(normalizeName("Côte d’Ivoire")).toBe("cote d ivoire");
    expect(normalizeName("The Gambia")).toBe("gambia");
    expect(normalizeName("Lagos State")).toBe("lagos");
    expect(normalizeName("Trinidad & Tobago")).toBe("trinidad and tobago");
  });
});

describe("matchLocation", () => {
  test("a code wins, in any case", () => {
    expect(matchLocation(INDEX, "nga", { level: "countries" })).toEqual({
      code: "NGA",
      name: "Nigeria",
    });
  });

  test("names match their normalized form, alternate names included", () => {
    expect(matchLocation(INDEX, "Cote d'Ivoire", { level: "countries" })?.code).toBe(
      "CIV",
    );
    expect(matchLocation(INDEX, "Ivory Coast", { level: "countries" })?.code).toBe("CIV");
  });

  test("the scope decides between a country and a state of the same name", () => {
    expect(matchLocation(INDEX, "Niger", { level: "countries" })?.code).toBe("NER");
    expect(matchLocation(INDEX, "Niger", { level: "states", country: "NGA" })?.code).toBe(
      "NG-NI",
    );
    expect(
      matchLocation(INDEX, "Lagos State", { level: "states", country: "NGA" }),
    ).toEqual({
      code: "NG-LA",
      name: "Lagos",
    });
  });

  test("an unknown or empty location matches nothing", () => {
    expect(matchLocation(INDEX, "Global", { level: "countries" })).toBeNull();
    expect(matchLocation(INDEX, "  ", { level: "countries" })).toBeNull();
    expect(matchLocation(INDEX, "Lagos", { level: "countries" })).toBeNull();
  });

  test("the committed index knows GBD's country and state names", () => {
    const at = (location: string) =>
      matchLocation(LOCATION_INDEX, location, { level: "countries" })?.code;
    expect(at("United States of America")).toBe("USA");
    expect(at("United Kingdom")).toBe("GBR");
    expect(at("Switzerland")).toBe("CHE");
    expect(at("France")).toBe("FRA");
    expect(at("Norway")).toBe("NOR");
    expect(
      matchLocation(LOCATION_INDEX, "California", { level: "states", country: "USA" })
        ?.code,
    ).toBe("US-CA");
    expect(
      matchLocation(LOCATION_INDEX, "Lagos", { level: "states", country: "NGA" })?.code,
    ).toBe("NG-LA");
  });
});

describe("subnationalCountries and countryName", () => {
  test("list countries with states and name a country", () => {
    expect(subnationalCountries(INDEX)).toEqual(["NGA"]);
    expect(countryName(INDEX, "NGA")).toBe("Nigeria");
    expect(countryName(INDEX, "XXX")).toBe("XXX");
  });

  test("the committed index has states for the 22 GBD subnational countries", () => {
    expect(subnationalCountries(LOCATION_INDEX).toSorted()).toEqual([
      "BRA",
      "CHN",
      "ETH",
      "GBR",
      "IDN",
      "IND",
      "IRN",
      "ITA",
      "JPN",
      "KEN",
      "MEX",
      "NGA",
      "NOR",
      "NZL",
      "PAK",
      "PHL",
      "POL",
      "RUS",
      "SWE",
      "UKR",
      "USA",
      "ZAF",
    ]);
  });
});

describe("layers (#421)", () => {
  const LAYERED: LocationIndex = {
    version: "test",
    countries: [],
    states: [
      { code: "GB-LDS", country: "GBR", name: "Leeds", names: [] },
      { code: "GB-SCT", country: "GBR", layer: "regions", name: "Scotland", names: [] },
      { code: "GB-SCT", country: "GBR", layer: "nations", name: "Scotland", names: [] },
      { code: "NG-LA", country: "NGA", name: "Lagos", names: [] },
    ],
  };

  test("layersOf lists the states, then nations, then regions", () => {
    expect(layersOf(LAYERED, "GBR")).toEqual([null, "nations", "regions"]);
    expect(layersOf(LAYERED, "NGA")).toEqual([null]);
    expect(layersOf(LAYERED, "XXX")).toEqual([]);
  });

  test("a scope matches only its own layer, the states without one", () => {
    const states = { level: "states", country: "GBR" } as const;
    expect(matchLocation(LAYERED, "Scotland", states)).toBeNull();
    expect(matchLocation(LAYERED, "Leeds", states)?.code).toBe("GB-LDS");
    expect(matchLocation(LAYERED, "GB-SCT", { ...states, layer: "nations" })?.code).toBe(
      "GB-SCT",
    );
    expect(matchLocation(LAYERED, "Leeds", { ...states, layer: "nations" })).toBeNull();
  });

  test("the committed index draws GBD's UK nations and English regions", () => {
    const scope = (layer: "nations" | "regions") =>
      ({ level: "states", country: "GBR", layer }) as const;
    expect(matchLocation(LOCATION_INDEX, "GB-ENG", scope("nations"))?.name).toBe(
      "England",
    );
    expect(
      matchLocation(LOCATION_INDEX, "North East England", scope("regions"))?.code,
    ).toBe("GBD-4618");
    expect(matchLocation(LOCATION_INDEX, "London", scope("regions"))?.code).toBe(
      "GBD-4624",
    );
  });
});
