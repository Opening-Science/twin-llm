import { describe, expect, test } from "bun:test";

import { LOCATION_INDEX } from "../../infrastructure/charts/choropleth/match-location";
import { GBD_LOCATION_TABLE } from "../../packages/gbd-local/location-table";

import {
  ENGLAND,
  ENGLISH_REGIONS,
  englishRegionOf,
  nationOf,
  OTHER_NATIONS,
  UK_NATIONS,
  ukLayers,
} from "./uk-levels";

/** Natural Earth's GBR local units, as the committed index has them. */
const LOCAL = LOCATION_INDEX.states.filter(
  (state) => state.country === "GBR" && state.layer === undefined,
);

const ENGLAND_ID = 4749;

describe("the UK mapping: local unit to English region to nation (#421)", () => {
  test("covers every Natural Earth GBR unit once, in one nation", () => {
    expect(LOCAL).toHaveLength(232);
    const listed = UK_NATIONS.flatMap((nation) => nation.members);
    expect(listed.toSorted()).toEqual(LOCAL.map((state) => state.code).toSorted());
    expect(new Set(listed).size).toBe(listed.length);
  });

  test("England's units are each in one region, and England is its regions", () => {
    const inRegions = ENGLISH_REGIONS.flatMap((region) => region.members);
    expect(new Set(inRegions).size).toBe(inRegions.length);
    expect(ENGLAND.members).toEqual(inRegions);
    expect(inRegions).toHaveLength(152);
    expect(OTHER_NATIONS.map((nation) => [nation.name, nation.members.length])).toEqual([
      ["Northern Ireland", 26],
      ["Scotland", 32],
      ["Wales", 22],
    ]);
  });

  test("regions are GBD's, with GBD's ids and names, and ONS's nine codes", () => {
    const gbd = GBD_LOCATION_TABLE.filter(([, parent]) => parent === ENGLAND_ID).map(
      ([id, , , name]) => [id, name],
    );
    expect(
      ENGLISH_REGIONS.map((region) => [region.gbdId, region.name]).toSorted(),
    ).toEqual(gbd.toSorted());
    expect(ENGLISH_REGIONS.map((region) => region.onsCode)).toEqual(
      Array.from({ length: 9 }, (_, at) => `E1200000${at + 1}`),
    );
  });

  test("nations carry GBD's ISO 3166-2 codes", () => {
    const codes = new Map(
      GBD_LOCATION_TABLE.filter(
        ([, , level, , iso3]) => level === 4 && iso3 === "GBR",
      ).map(([, , , name, , iso]) => [name, iso]),
    );
    // The table side may miss a nation, so compare as optional strings.
    expect<(string | null | undefined)[][]>(
      UK_NATIONS.map((nation) => [nation.name, nation.code]),
    ).toEqual(UK_NATIONS.map((nation) => [nation.name, codes.get(nation.name)]));
  });

  test("looks a unit up", () => {
    expect(englishRegionOf("GB-LDS")?.name).toBe("Yorkshire and the Humber");
    expect(englishRegionOf("GB-LND")?.name).toBe("Greater London");
    expect(englishRegionOf("GB-WRL")?.name).toBe("North West England");
    expect(englishRegionOf("GB-EDH")).toBeNull();
    expect(nationOf("GB-EDH")?.code).toBe("GB-SCT");
    expect(nationOf("GB-BST")?.code).toBe("GB-ENG");
    expect(nationOf("XX-1")).toBeNull();
  });
});

describe("ukLayers", () => {
  test("nations and the 12 ITL1 regions, codes unique within each", () => {
    const [nations, regions] = ukLayers();
    expect(nations?.layer).toBe("nations");
    expect(nations?.units.map((unit) => unit.code)).toEqual([
      "GB-ENG",
      "GB-NIR",
      "GB-SCT",
      "GB-WLS",
    ]);
    expect(regions?.layer).toBe("regions");
    const codes = regions?.units.map((unit) => unit.code) ?? [];
    expect(codes).toHaveLength(12);
    expect(new Set(codes).size).toBe(12);
    expect(codes.slice(0, 9).every((code) => /^GBD-46(1[89]|2[0-6])$/.test(code))).toBe(
      true,
    );
    expect(codes.slice(9)).toEqual(["GB-NIR", "GB-SCT", "GB-WLS"]);
  });

  test("an English region keeps ONS's name where GBD's differs", () => {
    const regions = ukLayers()[1]?.units ?? [];
    expect(regions.find((unit) => unit.name === "Greater London")?.names).toEqual([
      "London",
    ]);
    expect(regions.find((unit) => unit.name === "East Midlands")?.names).toBeUndefined();
  });
});
