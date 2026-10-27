import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { subjectFactsFrom } from "./subject-facts";

const FIXTURE_DIR = join(import.meta.dir, "../../tests/fixtures/synthea");

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8"));

const bundleWith = (patient: Record<string, unknown>): unknown => ({
  resourceType: "Bundle",
  entry: [{ resource: { resourceType: "Patient", id: "synthetic-1", ...patient } }],
});

describe("subjectFactsFrom", () => {
  test("the Synthea fixtures: sex and birth year, no death", () => {
    expect(subjectFactsFrom(fixture("patient-1.json"))).toEqual({
      sex: "female",
      birthYear: 1925,
    });
    expect(subjectFactsFrom(fixture("patient-2.json"))).toEqual({
      sex: "male",
      birthYear: 1998,
    });
    expect(subjectFactsFrom(fixture("bp-panel.json"))).toEqual({
      sex: "female",
      birthYear: 1968,
    });
  });

  test("death year from deceasedDateTime, as written, whatever the offset", () => {
    expect(
      subjectFactsFrom(
        bundleWith({
          gender: "male",
          birthDate: "1950-12-31",
          deceasedDateTime: "2019-12-31T23:30:00-05:00",
        }),
      ),
    ).toEqual({ sex: "male", birthYear: 1950, deathYear: 2019 });
  });

  test("a year-only or year-month birthDate still gives the year", () => {
    expect(subjectFactsFrom(bundleWith({ birthDate: "1971" }))).toEqual({
      birthYear: 1971,
    });
    expect(subjectFactsFrom(bundleWith({ birthDate: "1971-04" }))).toEqual({
      birthYear: 1971,
    });
  });

  test("what the Patient does not carry is left out, never null", () => {
    expect(subjectFactsFrom(bundleWith({}))).toEqual({});
    expect(subjectFactsFrom(bundleWith({ deceasedBoolean: true }))).toEqual({});
    expect(subjectFactsFrom({ resourceType: "Bundle", entry: [] })).toEqual({});
    expect(subjectFactsFrom(null)).toEqual({});
  });

  test("values outside FHIR's form are not stored", () => {
    expect(
      subjectFactsFrom(bundleWith({ gender: "F", birthDate: "20 May 1968" })),
    ).toEqual({});
    expect(subjectFactsFrom(bundleWith({ gender: "other" }))).toEqual({ sex: "other" });
  });

  test("a death year before the birth year is dropped", () => {
    expect(
      subjectFactsFrom(
        bundleWith({ birthDate: "1990-01-01", deceasedDateTime: "1980-01-01" }),
      ),
    ).toEqual({ birthYear: 1990 });
  });
});
