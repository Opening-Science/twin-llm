import { describe, expect, test } from "bun:test";

import { gbdEstimateRows, gbdPlaceLevel } from "./gbd-estimate-rows";

/** A `gbd_estimate` result with made-up values; they are not IHME estimates. */
const RESULT = {
  attribution: "made up",
  source: "IHME GBD 2023",
  measure: "deaths",
  metric: "rate",
  unit: "per 100,000",
  sex: "both",
  age: "age_standardized",
  cause: "Cardiovascular diseases",
  risk: null,
  n: 2,
  rows: [
    {
      location: "Georgia",
      location_id: 533,
      iso3: "USA",
      iso3166_2: "US-GA",
      year: 2021,
      value: 210,
      lower: 190,
      upper: 230,
    },
    {
      location: "Switzerland",
      location_id: 94,
      iso3: "CHE",
      iso3166_2: null,
      year: 2021,
      value: 100.5,
      lower: null,
      upper: null,
    },
  ],
  not_imported: [],
};

describe("gbdPlaceLevel", () => {
  test("reads the level from the GBD location map", () => {
    expect(gbdPlaceLevel(94)).toBe("country");
    expect(gbdPlaceLevel(533)).toBe("subnational");
    expect(gbdPlaceLevel(1)).toBe("aggregate");
    expect(gbdPlaceLevel(-5)).toBeUndefined();
  });
});

describe("gbdEstimateRows", () => {
  test("turns each row into an estimate with id, ISO codes, level and the result's fields", () => {
    expect(gbdEstimateRows(RESULT)).toEqual([
      {
        location: "Georgia",
        location_id: 533,
        iso3: "USA",
        iso3166_2: "US-GA",
        level: "subnational",
        value: 210,
        lower: 190,
        upper: 230,
        unit: "per 100,000",
        metric: "rate",
        measure: "deaths",
        cause: "Cardiovascular diseases",
        year: "2021",
        sex: "both",
        age: "age_standardized",
        source: "IHME GBD 2023",
      },
      {
        location: "Switzerland",
        location_id: 94,
        iso3: "CHE",
        iso3166_2: null,
        level: "country",
        value: 100.5,
        lower: null,
        upper: null,
        unit: "per 100,000",
        metric: "rate",
        measure: "deaths",
        cause: "Cardiovascular diseases",
        year: "2021",
        sex: "both",
        age: "age_standardized",
        source: "IHME GBD 2023",
      },
    ]);
  });

  test("names the risk and the cause, and leaves out an empty subject", () => {
    const risk = gbdEstimateRows({ ...RESULT, risk: "High systolic blood pressure" });
    expect(risk?.[0]?.cause).toBe(
      "High systolic blood pressure · Cardiovascular diseases",
    );
    const none = gbdEstimateRows({ ...RESULT, cause: null });
    expect(none?.[0]).not.toHaveProperty("cause");
  });

  test("leaves out the level of an id the map does not hold", () => {
    const rows = gbdEstimateRows({
      ...RESULT,
      rows: [{ ...RESULT.rows[0], location_id: -5 }],
    });
    expect(rows?.[0]).not.toHaveProperty("level");
  });

  test("is null for refusals, empty results and other shapes", () => {
    expect(gbdEstimateRows({ code: "GBD_NO_ESTIMATE", error: "x" })).toBeNull();
    expect(gbdEstimateRows({ ...RESULT, rows: [] })).toBeNull();
    expect(gbdEstimateRows([{ location: "X", value: 1 }])).toBeNull();
    expect(gbdEstimateRows(null)).toBeNull();
  });
});
