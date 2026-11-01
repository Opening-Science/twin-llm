import { describe, expect, test } from "bun:test";

import {
  findImportedName,
  gbdAgeId,
  importedChildIds,
  importedSdiIds,
  missingPairs,
  resolveGbdPlace,
  sortGbdEstimates,
} from "./estimate-rows";
import { gbdPanelRows } from "./panel-rows";

/** Imported names as a made-up import would list them. */
const IMPORTED = [
  { id: 94, name: "Switzerland" },
  { id: 81, name: "Germany" },
  { id: 523, name: "Alabama" },
  { id: 524, name: "Alaska" },
  { id: 35, name: "Georgia" },
  { id: 533, name: "Georgia" },
  { id: 44635, name: "High SDI" },
  { id: 44637, name: "Low SDI" },
];

describe("resolveGbdPlace", () => {
  test("by name, code or id", () => {
    expect(resolveGbdPlace("switzerland", IMPORTED)).toEqual({ kind: "found", id: 94 });
    expect(resolveGbdPlace("DEU", IMPORTED)).toEqual({ kind: "found", id: 81 });
    expect(resolveGbdPlace("US-AL", IMPORTED)).toEqual({ kind: "found", id: 523 });
    expect(resolveGbdPlace("44635", IMPORTED)).toEqual({ kind: "found", id: 44635 });
    // In the table but not imported: still a place; the read finds no rows.
    expect(resolveGbdPlace("France", IMPORTED)).toEqual({ kind: "found", id: 80 });
  });

  test("World is GBD's Global (#394)", () => {
    expect(resolveGbdPlace("World", IMPORTED)).toEqual({ kind: "found", id: 1 });
    expect(resolveGbdPlace("the world", IMPORTED)).toEqual({ kind: "found", id: 1 });
    expect(resolveGbdPlace("Global", IMPORTED)).toEqual({ kind: "found", id: 1 });
  });

  test("a repeated name is ambiguous, with the codes to ask again", () => {
    expect(resolveGbdPlace("Georgia", IMPORTED)).toEqual({
      kind: "ambiguous",
      options: ["Georgia (GEO)", "Georgia (US-GA)"],
    });
  });

  test("an unknown place or id is unknown", () => {
    expect(resolveGbdPlace("Atlantis", IMPORTED)).toEqual({ kind: "unknown" });
    expect(resolveGbdPlace("999999", IMPORTED)).toEqual({ kind: "unknown" });
  });
});

describe("children and SDI groups", () => {
  test("imported children of the United States", () => {
    expect(importedChildIds(102, IMPORTED)).toEqual([523, 524, 533]);
    expect(importedChildIds(94, IMPORTED)).toEqual([]);
  });

  test("inside Global: every imported country, no regions or states (#394)", () => {
    expect(
      importedChildIds(1, [...IMPORTED, { id: 73, name: "Western Europe" }]),
    ).toEqual([35, 81, 94]);
  });

  test("SDI groups by name", () => {
    expect(importedSdiIds(IMPORTED)).toEqual([44635, 44637]);
    expect(importedSdiIds(IMPORTED.slice(0, 2))).toEqual([]);
  });

  test("findImportedName ignores case", () => {
    expect(findImportedName("ALASKA", IMPORTED)).toEqual({ id: 524, name: "Alaska" });
    expect(findImportedName("Texas", IMPORTED)).toBeNull();
  });
});

describe("sortGbdEstimates and missingPairs", () => {
  test("oldest year first, then the largest value, then by name", () => {
    const rows = [
      { year: 2023, value: 1, location: "B" },
      { year: 2021, value: 5, location: "B" },
      { year: 2021, value: 5, location: "A" },
      { year: 2021, value: 9, location: "C" },
    ];
    expect(sortGbdEstimates(rows)).toEqual([
      { year: 2021, value: 9, location: "C" },
      { year: 2021, value: 5, location: "A" },
      { year: 2021, value: 5, location: "B" },
      { year: 2023, value: 1, location: "B" },
    ]);
  });

  test("pairs asked but not found, in the order asked", () => {
    expect(
      missingPairs(
        [94, 81],
        [2021, 2023],
        [
          { locationId: 94, year: 2021 },
          { locationId: 81, year: 2023 },
        ],
      ),
    ).toEqual([
      { locationId: 94, year: 2023 },
      { locationId: 81, year: 2021 },
    ]);
  });
});

describe("gbdPanelRows", () => {
  test("one panel row per estimate, risk before cause", () => {
    expect(
      gbdPanelRows({
        attribution: "a",
        source: "IHME GBD 2023",
        measure: "dalys",
        metric: "rate",
        unit: "per 100,000",
        sex: "both",
        age: "all_ages",
        cause: "All causes",
        risk: "High systolic blood pressure",
        n: 1,
        rows: [
          {
            location: "Switzerland",
            location_id: 94,
            iso3: "CHE",
            iso3166_2: null,
            year: 2021,
            value: 800,
            lower: 700,
            upper: 900,
          },
        ],
        not_imported: [],
      }),
    ).toEqual([
      {
        measure: "dalys",
        cause: "High systolic blood pressure · All causes",
        location: "Switzerland",
        year: "2021",
        sex: "both",
        age: "all_ages",
        value: 800,
        lower: 700,
        upper: 900,
        unit: "rate",
        source: "IHME GBD 2023",
      },
    ]);
  });
});

describe("gbdAgeId", () => {
  test("fixed ages read their own id once imported", () => {
    expect(gbdAgeId("all_ages", [22, 27])).toBe(22);
    expect(gbdAgeId("age_standardized", [2, 27])).toBe(27);
    expect(gbdAgeId("all_ages", [27])).toBeNull();
  });

  test("at birth is the youngest life table group imported: 0-6 days, else <1 year", () => {
    expect(gbdAgeId("at_birth", [2, 3, 8, 28])).toBe(2);
    expect(gbdAgeId("at_birth", [5, 28])).toBe(28);
    expect(gbdAgeId("at_birth", [22, 27])).toBeNull();
  });
});
