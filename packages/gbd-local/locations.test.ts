import { describe, expect, test } from "bun:test";

import {
  foldGbdName,
  gbdChildIds,
  gbdLocationByCode,
  gbdLocationById,
  gbdLocationsByName,
  isoMapping,
} from "./locations";
import { GBD_LOCATION_TABLE } from "./location-table";

describe("GBD location map", () => {
  test("holds the 204 GBD countries, each with a distinct alpha-3 code", () => {
    const countries = GBD_LOCATION_TABLE.filter((entry) => entry[2] === 3);
    expect(countries.length).toBe(204);
    expect(new Set(countries.map((entry) => entry[4])).size).toBe(204);
  });

  test("maps countries, subnational units, aggregates and unknown ids", () => {
    expect(isoMapping(94)).toEqual({ status: "country", iso3: "CHE" });
    expect(isoMapping(523)).toEqual({
      status: "subnational",
      iso3: "USA",
      iso3166_2: "US-AL",
    });
    expect(isoMapping(354)).toEqual({
      status: "subnational",
      iso3: "HKG",
      iso3166_2: "CN-HK",
    });
    expect(isoMapping(4749)).toEqual({
      status: "subnational",
      iso3: "GBR",
      iso3166_2: "GB-ENG",
    });
    // A Kenyan county, checked against ISO 3166-2:KE (#397).
    expect(isoMapping(35619)).toEqual({
      status: "subnational",
      iso3: "KEN",
      iso3166_2: "KE-03",
    });
    // An English local authority is no ISO subdivision here: no code is guessed.
    expect(isoMapping(44701)).toEqual({
      status: "subnational",
      iso3: "GBR",
      iso3166_2: null,
    });
    expect(isoMapping(1)).toEqual({ status: "aggregate" });
    expect(isoMapping(999_999)).toEqual({ status: "unmapped" });
  });

  test("finds by name, ignoring case and accents, and keeps repeated names apart", () => {
    expect(gbdLocationsByName("sao paulo").map((location) => location.id)).toEqual([
      4775,
    ]);
    expect(gbdLocationsByName("Georgia").map((location) => location.id)).toEqual([
      35, 533,
    ]);
  });

  test("finds by ISO 3166-1 alpha-3 and ISO 3166-2", () => {
    expect(gbdLocationByCode("che")?.id).toBe(94);
    expect(gbdLocationByCode("US-GA")?.id).toBe(533);
    expect(gbdLocationByCode("HKG")?.id).toBe(354);
    // The country's code never picks one of its subnational units.
    expect(gbdLocationByCode("USA")?.id).toBe(102);
    expect(gbdLocationByCode("XYZ")).toBeNull();
  });

  test("lists the children of a place", () => {
    expect(gbdChildIds(95)).toEqual([433, 434, 4636, 4749]);
    expect(gbdLocationById(4749)?.parentId).toBe(95);
  });

  test("foldGbdName drops case, accents and outer spaces", () => {
    expect(foldGbdName("  Ōsaka ")).toBe("osaka");
  });
});
