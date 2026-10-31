import { describe, expect, test } from "bun:test";

import {
  atRiskAfterAf,
  coOccurrence,
  mantelHaenszel,
  quantile,
  scoreAtAfOnset,
  scoreDistribution,
  strokeAfOrder,
  strokeByAnticoagulation,
  strokeByScore,
  timeToStroke,
} from "./af-tables";
import {
  day,
  person,
} from "../../packages/query-tools/event-rates/fixtures.test-helpers";

const YEAR = 365.25;

// A: AF at 70 with hypertension and diabetes before, stroke 2 years later.
const a = person("a", {
  birth: "1930-01-01",
  onset: {
    af: "2000-01-01",
    hypertension: "1990-01-01",
    diabetes: "1995-01-01",
    stroke: "2002-01-01",
  },
  anticoagulant: "2000-07-01",
});
// B: woman, AF at 60, no stroke, followed 10 years to death, never treated.
const b = person("b", {
  sex: "F",
  birth: "1940-01-01",
  end: "2010-01-01",
  died: true,
  onset: { af: "2000-01-01" },
});
// C: stroke before AF; not at risk after AF.
const c = person("c", { onset: { stroke: "1999-01-01", af: "2000-01-01" } });
// D: no AF.
const d = person("d", { onset: { sleepApnea: "2000-01-01" } });

describe("scoreAtAfOnset", () => {
  test("counts only what was recorded on or before AF onset", () => {
    expect(scoreAtAfOnset(a)).toBe(1 + 1 + 1); // age 65-74, hypertension, diabetes
    expect(scoreAtAfOnset(b)).toBe(0 + 1); // age 60, female
    expect(scoreAtAfOnset(c)).toBe(2); // prior stroke, age 60
    expect(scoreAtAfOnset(d)).toBeNull();
    expect(scoreDistribution([a, b, c, d])).toEqual({ 1: 1, 2: 1, 3: 1 });
  });
});

describe("stroke after AF", () => {
  test("people with a stroke on or before AF onset are left out", () => {
    expect(atRiskAfterAf([a, b, c, d]).map((p) => p.id)).toEqual(["a", "b"]);
  });

  test("rates by score group", () => {
    const rows = strokeByScore([a, b, c, d]);
    expect(rows.map((row) => [row.group, row.people, row.rate.events])).toEqual([
      ["0-1", 1, 0],
      ["2-3", 1, 1],
      ["4-5", 0, 0],
      ["6-9", 0, 0],
    ]);
    expect(rows[1]?.rate.personYears).toBeCloseTo(
      (day("2002-01-01") - day("2000-01-01")) / YEAR,
      9,
    );
    expect(rows[0]?.rate.personYears).toBeCloseTo(
      (day("2010-01-01") - day("2000-01-01")) / YEAR,
      9,
    );
  });

  test("anticoagulation splits person-time at the first order", () => {
    const table = strokeByAnticoagulation([a, b, c, d]);
    expect(table.atRisk).toBe(2);
    expect(table.everTreated).toBe(1);
    expect(table.medianDaysToFirstOrder).toBe(day("2000-07-01") - day("2000-01-01"));
    expect(table.with.events).toBe(1);
    expect(table.without.events).toBe(0);
    expect(table.with.personYears).toBeCloseTo(
      (day("2002-01-01") - day("2000-07-01")) / YEAR,
      9,
    );
    expect(table.without.personYears).toBeCloseTo(
      (day("2000-07-01") - day("2000-01-01") + day("2010-01-01") - day("2000-01-01")) /
        YEAR,
      9,
    );
    expect(table.ratio).toBeNull();
  });

  test("a stroke on the day of the first order counts as untreated", () => {
    const same = person("s", {
      onset: { af: "2000-01-01", stroke: "2001-01-01" },
      anticoagulant: "2001-01-01",
    });
    const table = strokeByAnticoagulation([same]);
    expect(table.without.events).toBe(1);
    expect(table.with.events).toBe(0);
  });

  test("time to stroke", () => {
    const later = person("l", { onset: { af: "2000-01-01", stroke: "2012-01-01" } });
    const result = timeToStroke([a, b, later]);
    expect(result.strokes).toBe(2);
    expect(result.byYears).toEqual({ "<1": 0, "1-5": 1, "5-10": 0, "10+": 1 });
    expect(result.medianDays).toBe(
      (day("2002-01-01") - day("2000-01-01") + day("2012-01-01") - day("2000-01-01")) / 2,
    );
  });
});

describe("quantile", () => {
  test("interpolates between sorted values", () => {
    expect(quantile([1, 2, 3, 4], 0.25)).toBe(1.75);
    expect(quantile([1, 2, 3, 4], 0.75)).toBe(3.25);
    expect(quantile([], 0.5)).toBeNull();
  });
});

describe("strokeAfOrder", () => {
  test("counts which came first", () => {
    const same = person("s", { onset: { af: "2000-01-01", stroke: "2000-01-01" } });
    expect(strokeAfOrder([a, b, c, d, same])).toEqual({
      both: 3,
      strokeFirst: 1,
      sameDay: 1,
      afFirst: 1,
    });
  });
});

describe("co-occurrence", () => {
  test("Mantel-Haenszel over two strata", () => {
    // Stratum 1: a=10 b=20 c=5 d=40 (n=75); stratum 2: a=2 b=8 c=4 d=30 (n=44).
    const or = mantelHaenszel([
      { both: 10, onlyA: 20, onlyB: 5, neither: 40 },
      { both: 2, onlyA: 8, onlyB: 4, neither: 30 },
    ]);
    expect(or).toBeCloseTo((400 / 75 + 60 / 44) / (100 / 75 + 32 / 44), 12);
    expect(mantelHaenszel([{ both: 1, onlyA: 0, onlyB: 0, neither: 1 }])).toBeNull();
  });

  test("ever sleep apnea against ever AF", () => {
    const both = person("x", { onset: { sleepApnea: "2000-01-01", af: "2001-01-01" } });
    const result = coOccurrence([a, b, c, d, both], "sleepApnea", "af");
    expect(result.table).toEqual({ both: 1, onlyA: 1, onlyB: 3, neither: 0 });
    expect(result.crudeOddsRatio).toBe(0);
  });
});

describe("complete window in the AF tables", () => {
  test("stroke after AF counts only inside the window, time is from AF onset", () => {
    const early = person("w", {
      observedFrom: "2016-01-01",
      onset: { af: "2000-01-01", stroke: "2018-01-01" },
    });
    const goneBefore = person("g", {
      observedFrom: "2016-01-01",
      onset: { af: "2000-01-01", stroke: "2010-01-01" },
    });
    const rows = strokeByScore([early, goneBefore]);
    const total = rows.reduce((sum, row) => sum + row.rate.personYears, 0);
    expect(total).toBeCloseTo((day("2018-01-01") - day("2016-01-01")) / YEAR, 9);
    expect(rows.reduce((sum, row) => sum + row.rate.events, 0)).toBe(1);
    expect(timeToStroke([early]).medianDays).toBe(day("2018-01-01") - day("2000-01-01"));
  });

  test("order inside the window leaves out onsets before it", () => {
    const old = person("o", {
      observedFrom: "2016-01-01",
      onset: { af: "2000-01-01", stroke: "2018-01-01" },
    });
    const recent = person("r", {
      observedFrom: "2016-01-01",
      onset: { stroke: "2017-01-01", af: "2019-01-01" },
    });
    expect(strokeAfOrder([old, recent], true)).toEqual({
      both: 1,
      strokeFirst: 1,
      sameDay: 0,
      afFirst: 0,
    });
    expect(strokeAfOrder([old, recent])).toEqual({
      both: 2,
      strokeFirst: 1,
      sameDay: 0,
      afFirst: 1,
    });
  });
});
