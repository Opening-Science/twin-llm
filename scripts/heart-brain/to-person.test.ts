import { describe, expect, test } from "bun:test";

import {
  ageYears,
  birthYear,
  dayNumber,
  observedStart,
} from "../../packages/query-tools/event-rates/cohort";

import { toPerson } from "./to-person";

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
