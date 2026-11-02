import { describe, expect, test } from "bun:test";

import type { GbdEstimateResult } from "@/packages/query-tools/gbd-estimate";
import type { GbdEstimateInput } from "@/packages/query-tools/gbd-estimate-schema";
import { gbdNoEstimate, gbdUnknownCause } from "@/packages/query-tools/gbd-refusals";

import {
  assembleCauseProfile,
  assembleLocationProfile,
  causeAge,
  causeBySexInputs,
  causeHighestInput,
  causeRateInputs,
  causeTrendInputs,
  comparisonIds,
  firstFound,
  latestYear,
  locationHeadlineInputs,
  mapInputs,
  PROFILE_CAUSE_CAP,
  PROFILE_YEARS,
  type ProfileCall,
  rankableCauses,
  unknownCauseNote,
} from "./profile";

/**
 * The pure half of `gbd_profile` (#403) over MADE-UP results: every value
 * below is invented for the test and is not an IHME estimate.
 */

const SWITZERLAND = { id: 94, name: "Switzerland", parentId: 73 };
const ATTRIBUTION =
  "Population estimate (IHME GBD 2023), not a statement about this person.";

type Row = Readonly<{ location: string; id: number; year: number; value: number }>;

const estimate = (
  input: GbdEstimateInput,
  rows: readonly Row[],
  fields: Partial<GbdEstimateResult> = {},
): GbdEstimateResult => ({
  attribution: ATTRIBUTION,
  source: "IHME GBD 2023",
  measure: input.measure,
  metric: input.metric,
  unit: input.metric === "years" ? "years" : "per 100,000",
  sex: input.sex,
  age: input.age,
  cause: input.cause ?? null,
  risk: null,
  n: rows.length,
  rows: rows.map((row) => ({
    location: row.location,
    location_id: row.id,
    iso3: null,
    iso3166_2: null,
    year: row.year,
    value: row.value,
    lower: row.value - 1,
    upper: row.value + 1,
  })),
  not_imported: [],
  ...fields,
});

const found = (
  input: GbdEstimateInput,
  rows: readonly Row[],
  auditIds: readonly string[],
  fields: Partial<GbdEstimateResult> = {},
): ProfileCall => ({ input, result: estimate(input, rows, fields), auditIds });

const refused = (input: GbdEstimateInput, auditIds: readonly string[]): ProfileCall => ({
  input,
  result: gbdNoEstimate("these places and years"),
  auditIds,
});

describe("the plan", () => {
  test("compares a place with its parent and the world, once each", () => {
    expect(comparisonIds(SWITZERLAND)).toEqual([94, 73, 1]);
    expect(comparisonIds({ id: 1, name: "Global", parentId: null })).toEqual([1]);
    expect(comparisonIds({ id: 64, name: "High-income", parentId: 1 })).toEqual([64, 1]);
  });

  test("starts with HALE and life expectancy at birth over every profile year", () => {
    const { hale, lifeExpectancy } = locationHeadlineInputs(SWITZERLAND);
    expect(hale).toEqual({
      measure: "hale",
      metric: "years",
      sex: "both",
      age: "at_birth",
      locations: ["94", "73", "1"],
      years: [...PROFILE_YEARS],
    });
    expect(lifeExpectancy.measure).toBe("life_expectancy");
    expect(PROFILE_YEARS.length).toBeLessThanOrEqual(10);
    expect(PROFILE_YEARS.at(-1)).toBe(2023);
  });

  test("the latest year is the place's own when it has rows, else any place's", () => {
    const { hale } = locationHeadlineInputs(SWITZERLAND);
    const calls = [
      found(
        hale,
        [
          { location: "Switzerland", id: 94, year: 2022, value: 70.5 },
          { location: "Global", id: 1, year: 2023, value: 62.5 },
        ],
        ["1"],
      ),
    ];
    expect(latestYear(calls, 94)).toBe(2022);
    expect(latestYear(calls, 81)).toBe(2023);
    expect(latestYear(calls, null)).toBe(2023);
    expect(latestYear([refused(hale, ["2"])], 94)).toBeNull();
  });

  test("ranks imported causes by name, never All causes, capped", () => {
    expect(
      rankableCauses([
        { id: 294, name: "All causes" },
        { id: 587, name: "Diabetes mellitus" },
        { id: 491, name: "Cardiovascular diseases" },
      ]),
    ).toEqual({ names: ["Cardiovascular diseases", "Diabetes mellitus"], total: 2 });
    const many = Array.from({ length: PROFILE_CAUSE_CAP + 5 }, (_, index) => ({
      id: index + 1000,
      name: `Cause ${String(index).padStart(2, "0")}`,
    }));
    const ranked = rankableCauses(many);
    expect(ranked.names).toHaveLength(PROFILE_CAUSE_CAP);
    expect(ranked.total).toBe(PROFILE_CAUSE_CAP + 5);
  });

  test("one age-standardised rate call per cause, place and year", () => {
    expect(causeRateInputs("dalys", 94, 2023, ["Cardiovascular diseases"])).toEqual([
      {
        measure: "dalys",
        metric: "rate",
        cause: "Cardiovascular diseases",
        sex: "both",
        age: "age_standardized",
        locations: ["94"],
        years: [2023],
      },
    ]);
  });

  test("the map asks for the units inside the place, then its neighbours", () => {
    expect(mapInputs(SWITZERLAND, 2023).map((input) => input.children_of)).toEqual([
      "94",
      "73",
    ]);
    expect(
      mapInputs({ id: 1, name: "Global", parentId: null }, 2023).map(
        (input) => input.children_of,
      ),
    ).toEqual(["1"]);
  });

  test("a cause profile reads the world's rate, age-standardised before all ages", () => {
    const [first, second] = causeTrendInputs("Diabetes mellitus", "dalys");
    expect(first).toMatchObject({ age: "age_standardized", locations: ["1"] });
    expect(second).toMatchObject({ age: "all_ages", locations: ["1"] });
    expect(causeHighestInput("Diabetes mellitus", "all_ages", 2023)).toEqual({
      measure: "dalys",
      metric: "rate",
      cause: "Diabetes mellitus",
      sex: "both",
      age: "all_ages",
      children_of: "1",
      years: [2023],
    });
    expect(
      causeBySexInputs("Diabetes mellitus", "all_ages", 2023).map((i) => i.sex),
    ).toEqual(["female", "male"]);
  });

  test("the age and the call that count are the first with rows", () => {
    const [standardised, allAges] = causeTrendInputs("Diabetes mellitus", "dalys");
    const miss = refused(standardised!, ["1"]);
    const hit = found(
      allAges!,
      [{ location: "Global", id: 1, year: 2023, value: 900 }],
      ["2"],
    );
    expect(causeAge([miss, hit])).toBe("all_ages");
    expect(causeAge([miss])).toBe("age_standardized");
    expect(firstFound([miss, hit])).toBe(hit);
    expect(firstFound([miss])).toBe(miss);
    expect(firstFound([])).toBeNull();
  });
});

describe("a location profile", () => {
  const { hale, lifeExpectancy } = locationHeadlineInputs(SWITZERLAND);

  test("with only HALE imported, every other section says plainly that it is not imported", () => {
    const haleCall = found(
      hale,
      [
        { location: "Switzerland", id: 94, year: 2023, value: 70.25 },
        { location: "Western Europe", id: 73, year: 2023, value: 68.5 },
        { location: "Global", id: 1, year: 2023, value: 61.75 },
      ],
      ["11"],
    );
    const profile = assembleLocationProfile({
      place: SWITZERLAND,
      hale: haleCall,
      lifeExpectancy: refused(lifeExpectancy, ["12"]),
      year: 2023,
      causes: { names: [], total: 0 },
      dalys: [],
      map: null,
    });
    expect(profile.kind).toBe("location");
    expect(profile.subject).toBe("Switzerland");
    expect(profile.year).toBe(2023);
    expect(profile.attribution).toBe(ATTRIBUTION);
    expect(profile.sections.map((entry) => [entry.id, entry.status, entry.note])).toEqual(
      [
        ["hale", "shown", null],
        [
          "life_expectancy",
          "not_imported",
          "Life expectancy at birth for Switzerland is not imported.",
        ],
        [
          "trend",
          "not_imported",
          "Only 2023 is imported for Switzerland, so there is no trend.",
        ],
        [
          "top_dalys",
          "not_imported",
          "No causes other than All causes are imported, so top causes of DALYs are not shown.",
        ],
        [
          "map",
          "not_imported",
          "HALE for places inside or next to Switzerland is not imported, so there is no map.",
        ],
      ],
    );
    const [haleSection] = profile.sections;
    expect(haleSection?.title).toBe(
      "Healthy life expectancy (HALE) at birth, 2023: Switzerland, its region and the world",
    );
    expect(haleSection?.rows).toEqual([
      { label: "Switzerland", year: 2023, value: 70.25, lower: 69.25, upper: 71.25 },
      { label: "Western Europe", year: 2023, value: 68.5, lower: 67.5, upper: 69.5 },
      { label: "Global", year: 2023, value: 61.75, lower: 60.75, upper: 62.75 },
    ]);
    expect(haleSection?.auditIds).toEqual(["11"]);
    expect(profile.map).toBeNull();
  });

  test("names the places with no row in the year, shows a trend over two years and ranks causes", () => {
    const haleCall = found(
      hale,
      [
        { location: "Switzerland", id: 94, year: 2022, value: 70 },
        { location: "Switzerland", id: 94, year: 2023, value: 70.5 },
      ],
      ["1"],
      { not_imported: [{ location: "Western Europe", year: 2023 }] },
    );
    const dalys = [
      found(
        causeRateInputs("dalys", 94, 2023, ["Cardiovascular diseases"])[0]!,
        [{ location: "Switzerland", id: 94, year: 2023, value: 2000 }],
        ["3"],
        { cause: "Cardiovascular diseases" },
      ),
      found(
        causeRateInputs("dalys", 94, 2023, ["Neoplasms"])[0]!,
        [{ location: "Switzerland", id: 94, year: 2023, value: 3000 }],
        ["4"],
        { cause: "Neoplasms" },
      ),
      refused(causeRateInputs("dalys", 94, 2023, ["Diabetes mellitus"])[0]!, ["5"]),
    ];
    const mapCall = found(
      mapInputs(SWITZERLAND, 2023)[1]!,
      [{ location: "Germany", id: 81, year: 2023, value: 68 }],
      ["6"],
    );
    const profile = assembleLocationProfile({
      place: SWITZERLAND,
      hale: haleCall,
      lifeExpectancy: null,
      year: 2023,
      causes: {
        names: ["Cardiovascular diseases", "Diabetes mellitus", "Neoplasms"],
        total: 3,
      },
      dalys,
      map: mapCall,
      deaths: [],
    });
    const byId = new Map(profile.sections.map((entry) => [entry.id, entry]));
    expect(byId.get("hale")?.note).toBe("Not imported for Western Europe.");
    expect(
      byId.get("trend")?.rows.map((row) => [row.label, row.year, row.value]),
    ).toEqual([
      ["HALE", 2022, 70],
      ["HALE", 2023, 70.5],
    ]);
    const top = byId.get("top_dalys");
    expect(top?.ranked).toBe(true);
    expect(top?.rows.map((row) => [row.label, row.value])).toEqual([
      ["Neoplasms", 3000],
      ["Cardiovascular diseases", 2000],
    ]);
    expect(top?.auditIds).toEqual(["3", "4", "5"]);
    expect(byId.get("map")?.status).toBe("shown");
    expect(profile.map?.world).toBe(false);
    expect(profile.map?.auditIds).toEqual(["6"]);
    expect(byId.get("top_deaths")?.note).toBe(
      "Age-standardised death rates by cause for Switzerland in 2023 are not imported.",
    );
    expect(profile.sections.at(-1)?.id).toBe("top_deaths");
  });

  test("leaves deaths out unless asked", () => {
    const profile = assembleLocationProfile({
      place: SWITZERLAND,
      hale: null,
      lifeExpectancy: null,
      year: null,
      causes: { names: [], total: 0 },
      dalys: [],
      map: null,
    });
    expect(profile.sections.map((entry) => entry.id)).not.toContain("top_deaths");
    expect(profile.year).toBeNull();
    expect(profile.sections.find((entry) => entry.id === "trend")?.note).toBe(
      "No estimates over time for Switzerland are imported, so there is no trend.",
    );
  });
});

describe("a cause profile", () => {
  const [standardised] = causeTrendInputs("Diabetes mellitus", "dalys");

  test("ranks where it is highest, its trend and by sex; the world's map", () => {
    const highestInput = causeHighestInput("Diabetes mellitus", "age_standardized", 2023);
    const countries = Array.from({ length: 12 }, (_, index) => ({
      location: `Country ${index + 1}`,
      id: 200 + index,
      year: 2023,
      value: 100 + index,
    }));
    const [female, male] = causeBySexInputs(
      "Diabetes mellitus",
      "age_standardized",
      2023,
    );
    const profile = assembleCauseProfile({
      cause: "Diabetes mellitus",
      trend: found(
        standardised!,
        [
          { location: "Global", id: 1, year: 2021, value: 800 },
          { location: "Global", id: 1, year: 2023, value: 850 },
        ],
        ["1"],
      ),
      year: 2023,
      highest: found(highestInput, countries, ["2"]),
      bySex: [
        found(female!, [{ location: "Global", id: 1, year: 2023, value: 820 }], ["3"]),
        found(male!, [{ location: "Global", id: 1, year: 2023, value: 880 }], ["4"]),
      ],
    });
    expect(profile.kind).toBe("cause");
    expect(profile.sections.map((entry) => entry.id)).toEqual([
      "highest",
      "trend",
      "by_sex",
      "map",
    ]);
    const [highest, trend, bySex, map] = profile.sections;
    expect(highest?.title).toBe(
      "Where Diabetes mellitus DALYs are highest, 2023: rate per 100,000, age-standardised",
    );
    expect(highest?.rows).toHaveLength(10);
    expect(highest?.rows[0]?.label).toBe("Country 12");
    expect(highest?.note).toBe("The 10 highest of 12 imported countries.");
    expect(trend?.rows.map((row) => row.value)).toEqual([800, 850]);
    expect(bySex?.rows.map((row) => [row.label, row.value])).toEqual([
      ["Female", 820],
      ["Male", 880],
    ]);
    expect(map?.rows).toHaveLength(12);
    expect(profile.map?.world).toBe(true);
  });

  test("a cause that is not imported says so in every section", () => {
    const note = unknownCauseNote("Diabetes mellitus", [{ id: 294, name: "All causes" }]);
    expect(note).toBe("Diabetes mellitus is not imported; imported causes: All causes.");
    expect(unknownCauseNote("Asthma", [])).toBe(
      "No cause estimates are imported, so Asthma is not imported.",
    );
    const profile = assembleCauseProfile({
      cause: "Diabetes mellitus",
      unknown: note,
      trend: {
        input: standardised!,
        result: gbdUnknownCause("Diabetes mellitus", ["All causes"]),
        auditIds: ["9"],
      },
      year: null,
      highest: null,
      bySex: [],
      deaths: null,
    });
    expect(profile.sections.map((entry) => [entry.id, entry.status, entry.note])).toEqual(
      [
        ["highest", "not_imported", note],
        ["trend", "not_imported", note],
        ["by_sex", "not_imported", note],
        ["map", "not_imported", note],
        ["deaths_trend", "not_imported", note],
      ],
    );
    expect(profile.sections.find((entry) => entry.id === "trend")?.auditIds).toEqual([
      "9",
    ]);
  });
});
