import { describe, expect, test } from "bun:test";

import { ageInYear, sexAgeSplit, type SubjectFactsRow } from "./sex-age-split";

const row = (
  sex: string | null,
  birthYear: number | null,
  subjects: number,
  deathYear: number | null = null,
): SubjectFactsRow => ({ sex, birthYear, deathYear, subjects });

const counts = (female: number, male: number, notStored = 0) => ({
  female,
  male,
  other: 0,
  unknown: 0,
  "not-stored": notStored,
});

describe("ageInYear", () => {
  test("the age reached in the reference year, or in the year of death", () => {
    expect(ageInYear({ birthYear: 1970, deathYear: null }, 2025)).toBe(55);
    expect(ageInYear({ birthYear: 1950, deathYear: 2019 }, 2025)).toBe(69);
    expect(ageInYear({ birthYear: null, deathYear: null }, 2025)).toBeNull();
    expect(ageInYear({ birthYear: 1970, deathYear: null }, null)).toBeNull();
    expect(ageInYear({ birthYear: 1950, deathYear: 2019 }, null)).toBe(69);
  });
});

describe("sexAgeSplit", () => {
  test("hand-counted cohort: bands from youngest to oldest, the empty one kept", () => {
    // Reference year 2025. Ages: 55 (×3 F), 59 (2 M), 49 (F), 75 (M), and a man
    // born 1950 who died in 2019 at 69. No one is in their 60s except him.
    const split = sexAgeSplit(
      [
        row("female", 1970, 3),
        row("male", 1966, 2),
        row("female", 1976, 1),
        row("male", 1950, 1),
        row("male", 1950, 1, 2019),
      ],
      2025,
    );
    expect(split).toEqual({
      referenceYear: 2025,
      columns: ["female", "male"],
      bands: [
        { id: "40", label: "40–49", from: 40, counts: counts(1, 0), total: 1 },
        { id: "50", label: "50–59", from: 50, counts: counts(3, 2), total: 5 },
        { id: "60", label: "60–69", from: 60, counts: counts(0, 1), total: 1 },
        { id: "70", label: "70–79", from: 70, counts: counts(0, 1), total: 1 },
      ],
      totals: counts(4, 4),
      total: 8,
      deceased: 1,
      withFacts: 8,
    });
  });

  test("subjects without stored facts are counted apart, never put in a band", () => {
    const split = sexAgeSplit(
      [row("female", 1980, 2), row(null, null, 3), row("male", null, 1)],
      2025,
    );
    expect(split.columns).toEqual(["female", "male", "not-stored"]);
    expect(split.bands).toEqual([
      { id: "40", label: "40–49", from: 40, counts: counts(2, 0), total: 2 },
      {
        id: "no-birth-year",
        label: "Birth year not stored",
        from: null,
        counts: counts(0, 1, 3),
        total: 4,
      },
    ]);
    expect(split.total).toBe(6);
    expect(split.withFacts).toBe(2);
  });

  test("a cohort ingested before the facts were stored has no age band", () => {
    expect(sexAgeSplit([row(null, null, 37)], 2025)).toEqual({
      referenceYear: 2025,
      columns: ["not-stored"],
      bands: [
        {
          id: "no-birth-year",
          label: "Birth year not stored",
          from: null,
          counts: counts(0, 0, 37),
          total: 37,
        },
      ],
      totals: counts(0, 0, 37),
      total: 37,
      deceased: 0,
      withFacts: 0,
    });
  });

  test("an empty cohort gives no bands", () => {
    expect(sexAgeSplit([], null)).toEqual({
      referenceYear: null,
      columns: [],
      bands: [],
      totals: counts(0, 0),
      total: 0,
      deceased: 0,
      withFacts: 0,
    });
  });
});
