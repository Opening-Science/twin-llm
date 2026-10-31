import { describe, expect, test } from "bun:test";

import {
  ageYears,
  birthYear,
  dayNumber,
  historyStart,
  observedStart,
  toPerson,
  withOnset,
} from "./cohort";

describe("dayNumber", () => {
  test("counts UTC days from 1970-01-01", () => {
    expect(dayNumber("1970-01-01")).toBe(0);
    expect(dayNumber("1970-01-31")).toBe(30);
    expect(dayNumber("1969-12-31")).toBe(-1);
  });
});

describe("toPerson", () => {
  test("a deceased person ends on the day of death", () => {
    const person = toPerson(
      {
        id: "p",
        batch: "001",
        sex: "F",
        birth: "1950-01-01",
        death: "2000-01-01",
        onsets: { af: "1999-01-01" },
        anticoagulantStart: null,
      },
      "2026-01-01",
      10,
    );
    expect(person.end).toBe(dayNumber("2000-01-01"));
    expect(person.died).toBe(true);
    expect(person.onset).toEqual({ af: dayNumber("1999-01-01") });
    expect(birthYear(person)).toBe(1950);
    expect(ageYears(person, dayNumber("2000-01-01"))).toBeCloseTo(50, 2);
  });

  test("a living person ends on the batch end date", () => {
    const person = toPerson(
      {
        id: "p",
        batch: "001",
        sex: null,
        birth: "2000-01-01",
        death: null,
        onsets: {},
        anticoagulantStart: "2010-01-01",
      },
      "2026-01-01",
      10,
    );
    expect(person.end).toBe(dayNumber("2026-01-01"));
    expect(person.anticoagulant).toBe(dayNumber("2010-01-01"));
  });
});

describe("withOnset", () => {
  test("replaces and removes one onset", () => {
    const person = toPerson(
      {
        id: "p",
        batch: "001",
        sex: "M",
        birth: "1950-01-01",
        death: null,
        onsets: { af: "2000-01-01", stroke: "2001-01-01" },
        anticoagulantStart: null,
      },
      "2026-01-01",
      10,
    );
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

  test("toPerson sets it and observedStart clamps to it", () => {
    const person = toPerson(
      {
        id: "p",
        batch: "001",
        sex: "M",
        birth: "1950-01-01",
        death: null,
        onsets: {},
        anticoagulantStart: null,
      },
      "2026-01-01",
      10,
    );
    expect(person.observedFrom).toBe(dayNumber("2016-01-01"));
    expect(observedStart(person, dayNumber("2000-01-01"))).toBe(dayNumber("2016-01-01"));
    expect(observedStart(person, dayNumber("2020-01-01"))).toBe(dayNumber("2020-01-01"));
  });
});
