import { describe, expect, test } from "bun:test";

import {
  ageYears,
  birthYear,
  dayNumber,
  historyStart,
  observedStart,
  withOnset,
} from "./cohort";
import { person as fixture } from "./fixtures.test-helpers";

describe("dayNumber", () => {
  test("counts UTC days from 1970-01-01", () => {
    expect(dayNumber("1970-01-01")).toBe(0);
    expect(dayNumber("1970-01-31")).toBe(30);
    expect(dayNumber("1969-12-31")).toBe(-1);
  });
});

describe("withOnset", () => {
  test("replaces and removes one onset", () => {
    const person = fixture("p", { onset: { af: "2000-01-01", stroke: "2001-01-01" } });
    expect(withOnset(person, "af", 5).onset).toEqual({
      af: 5,
      stroke: dayNumber("2001-01-01"),
    });
    expect(withOnset(person, "af", null).onset).toEqual({
      stroke: dayNumber("2001-01-01"),
    });
  });
});

describe("history window", () => {
  test("starts the same calendar day the given years earlier", () => {
    expect(historyStart("2026-01-01", 10)).toBe(dayNumber("2016-01-01"));
    expect(historyStart("2026-01-01", 0)).toBe(Number.NEGATIVE_INFINITY);
  });

  test("observedStart clamps to the window's first day", () => {
    const person = { observedFrom: dayNumber("2016-01-01") };
    expect(observedStart(person, dayNumber("2000-01-01"))).toBe(dayNumber("2016-01-01"));
    expect(observedStart(person, dayNumber("2020-01-01"))).toBe(dayNumber("2020-01-01"));
  });
});

describe("ageYears and birthYear", () => {
  test("read age in 365.25-day years and the UTC birth year", () => {
    const person = { birth: dayNumber("1950-07-02") };
    expect(ageYears(person, dayNumber("2005-07-02"))).toBeCloseTo(55.0007, 4);
    expect(birthYear(person)).toBe(1950);
  });
});
