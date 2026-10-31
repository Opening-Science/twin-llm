import { describe, expect, test } from "bun:test";

import { randomFor } from "../synthetic-wearables/random";

import { day, person } from "./fixtures.test-helpers";
import { matchedIncidence } from "./matched";

const YEAR = 365.25;

describe("matchedIncidence", () => {
  test("one exposed person and one eligible control", () => {
    const exposed = person("e", { onset: { af: "2000-01-01", stroke: "2001-01-01" } });
    const control = person("c", { onset: { af: "2005-01-01" } });
    const other = person("o", { sex: "F" });
    const tooOld = person("t", { birth: "1930-01-01" });
    const result = matchedIncidence(
      [exposed, control, other, tooOld],
      { exposure: "af", outcome: "stroke", controlsPerExposed: 1 },
      randomFor(1, "test"),
    );
    // The control is followed until their own AF onset, and then enters as exposed
    // (with no eligible control of their own: e is exposed, o is a woman, t too old).
    expect(result.exposed.events).toBe(1);
    expect(result.exposed.personYears).toBeCloseTo(
      (day("2001-01-01") - day("2000-01-01") + day("2026-01-01") - day("2005-01-01")) /
        YEAR,
      9,
    );
    expect(result.controls.events).toBe(0);
    expect(result.controls.personYears).toBeCloseTo(
      (day("2005-01-01") - day("2000-01-01")) / YEAR,
      9,
    );
    expect(result.exposedPeople).toBe(2);
    expect(result.controlPeople).toBe(1);
    expect(result.shortOfControls).toBe(1);
    expect(result.ratio).toBeNull();
  });

  test("controls with the outcome before the index day, the other sex or no follow-up are never drawn", () => {
    const exposed = person("e", { onset: { af: "2000-01-01" } });
    const hadOutcome = person("h", { onset: { stroke: "1999-01-01" } });
    const dead = person("d", { end: "1999-06-01", died: true });
    const woman = person("w", { sex: "F" });
    const result = matchedIncidence(
      [exposed, hadOutcome, dead, woman],
      { exposure: "af", outcome: "stroke", controlsPerExposed: 2 },
      randomFor(1, "test"),
    );
    expect(result.controlPeople).toBe(0);
    expect(result.shortOfControls).toBe(1);
    expect(result.controls.personYears).toBe(0);
  });

  test("an exposed person with the outcome first is not entered", () => {
    const exposed = person("e", { onset: { stroke: "1999-01-01", af: "2000-01-01" } });
    const result = matchedIncidence(
      [exposed, person("c")],
      { exposure: "af", outcome: "stroke", controlsPerExposed: 1 },
      randomFor(1, "test"),
    );
    expect(result.exposedPeople).toBe(0);
    expect(result.controlPeople).toBe(0);
  });
});

describe("keepExposed", () => {
  test("leaves out exposed people the filter rejects", () => {
    const young = person("y", { birth: "1960-01-01", onset: { af: "2000-01-01" } });
    const old = person("o", { birth: "1930-01-01", onset: { af: "2000-01-01" } });
    const result = matchedIncidence(
      [young, old],
      {
        exposure: "af",
        outcome: "stroke",
        controlsPerExposed: 1,
        keepExposed: (p) => p.id === "o",
      },
      randomFor(1, "test"),
    );
    expect(result.exposedPeople).toBe(1);
    expect(result.exposed.personYears).toBeCloseTo(
      (day("2026-01-01") - day("2000-01-01")) / YEAR,
      9,
    );
  });
});

describe("complete window", () => {
  test("person-time and outcomes count only from the window start", () => {
    const exposed = person("e", {
      observedFrom: "2016-01-01",
      onset: { af: "2000-01-01", stroke: "2020-01-01" },
    });
    // Eligible on the index day, but the outcome falls before the window opens.
    const control = person("c", {
      observedFrom: "2016-01-01",
      onset: { stroke: "2010-01-01" },
    });
    const result = matchedIncidence(
      [exposed, control],
      { exposure: "af", outcome: "stroke", controlsPerExposed: 1 },
      randomFor(5, "window"),
    );
    expect(result.exposed.events).toBe(1);
    expect(result.exposed.personYears).toBeCloseTo(
      (day("2020-01-01") - day("2016-01-01")) / YEAR,
      9,
    );
    expect(result.controlPeople).toBe(1);
    expect(result.controls.personYears).toBe(0);
    expect(result.controls.events).toBe(0);
  });
});
