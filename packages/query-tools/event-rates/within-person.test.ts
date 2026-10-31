import { describe, expect, test } from "bun:test";

import { day, person } from "./fixtures.test-helpers";
import {
  BEFORE,
  personPieces,
  timingResult,
  type TimingSpec,
  timingTable,
  windowLabels,
} from "./within-person";

const spec = (minAgeYears = 0, ageBandYears = 5): TimingSpec => ({
  exposure: "af",
  outcome: "stroke",
  minAgeYears,
  afterWindowsYears: [0, 2, 5],
  ageBandYears,
});

const total = (pieces: readonly { days: number }[]) =>
  pieces.reduce((sum, piece) => sum + piece.days, 0);

describe("windowLabels", () => {
  test("names each window from its offsets", () => {
    expect(windowLabels([0, 2, 5])).toEqual(["0-2 y", "2-5 y", "5+ y"]);
    expect(windowLabels([0])).toEqual(["0+ y"]);
  });
});

describe("personPieces", () => {
  test("cuts counted time at onset, the after windows and age bands", () => {
    const p = person("a", {
      birth: "1950-01-01",
      observedFrom: "2016-01-01",
      onset: { af: "2018-01-01" },
    });
    const pieces = personPieces(p, spec()) ?? [];
    expect(total(pieces)).toBe(day("2026-01-01") - day("2016-01-01"));
    expect(total(pieces.filter((x) => x.window === BEFORE))).toBe(
      day("2018-01-01") - day("2016-01-01"),
    );
    expect(total(pieces.filter((x) => x.window === "0-2 y"))).toBe(730);
    expect(new Set(pieces.map((x) => x.ageBand))).toEqual(new Set([13, 14, 15]));
    expect(pieces.some((x) => x.event)).toBe(false);
  });

  test("stops at the stroke in the cohort mode and marks its piece", () => {
    const p = person("b", {
      birth: "1950-01-01",
      observedFrom: "2016-01-01",
      onset: { af: "2018-01-01", stroke: "2019-06-01" },
    });
    const pieces = personPieces(p, spec()) ?? [];
    expect(total(pieces)).toBe(day("2019-06-01") - day("2016-01-01"));
    const events = pieces.filter((x) => x.event);
    expect(events).toHaveLength(1);
    expect(events[0]?.window).toBe("0-2 y");
  });

  test("a stroke on the onset day counts before it", () => {
    const p = person("c", {
      observedFrom: "2016-01-01",
      onset: { af: "2018-01-01", stroke: "2018-01-01" },
    });
    expect(personPieces(p, spec())?.find((x) => x.event)?.window).toBe(BEFORE);
  });

  test("the case-series mode follows a case past the stroke and drops non-cases", () => {
    const withStroke = person("d", {
      observedFrom: "2016-01-01",
      onset: { af: "2018-01-01", stroke: "2017-01-01" },
    });
    const pieces = personPieces(withStroke, spec(), "case-series") ?? [];
    expect(total(pieces)).toBe(day("2026-01-01") - day("2016-01-01"));
    expect(pieces.filter((x) => x.event).map((x) => x.window)).toEqual([BEFORE]);
    const noStroke = person("e", { onset: { af: "2018-01-01" } });
    expect(personPieces(noStroke, spec(), "case-series")).toBeNull();
  });

  test("starts at the minimum age; a stroke before counted time drops the person", () => {
    const p = person("f", {
      birth: "1965-01-01",
      observedFrom: "2016-01-01",
      onset: { af: "2017-01-01" },
    });
    const pieces = personPieces(p, spec(55)) ?? [];
    expect(total(pieces)).toBe(day("2026-01-01") - day("2020-01-01"));
    expect(pieces.every((x) => x.window !== BEFORE)).toBe(true);
    const early = person("g", {
      observedFrom: "2016-01-01",
      onset: { af: "2018-01-01", stroke: "2015-01-01" },
    });
    expect(personPieces(early, spec())).toBeNull();
    expect(personPieces(person("h"), spec())).toBeNull();
  });
});

describe("timingTable and timingResult", () => {
  test("pools people and compares after with before, crude and by age band", () => {
    const people = [
      person("1", {
        birth: "1950-01-01",
        observedFrom: "2016-01-01",
        onset: { af: "2021-01-01", stroke: "2024-01-01" },
      }),
      person("2", {
        birth: "1950-01-01",
        observedFrom: "2016-01-01",
        onset: { af: "2021-01-01", stroke: "2018-01-01" },
      }),
      person("3", {
        birth: "1950-01-01",
        observedFrom: "2016-01-01",
        onset: { af: "2021-01-01", stroke: "2010-01-01" },
      }),
      person("4", { birth: "1950-01-01", observedFrom: "2016-01-01" }),
    ];
    const table = timingTable(people, spec());
    expect(table.people).toBe(2);
    expect(table.outcomeBefore).toBe(1);
    const result = timingResult(table, spec());
    expect(result.before.events).toBe(1);
    expect(result.after.rate.events).toBe(1);
    expect(result.windows.map((w) => w.window)).toEqual(["0-2 y", "2-5 y", "5+ y"]);
    expect(result.windows.map((w) => w.rate.events)).toEqual([0, 1, 0]);
    const beforeYears = result.before.personYears;
    const afterYears = result.after.rate.personYears;
    expect(result.after.crude?.ratio).toBeCloseTo(beforeYears / afterYears, 6);
  });
});
