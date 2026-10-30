import { describe, expect, test } from "bun:test";

import { person } from "./fixtures.test-helpers";
import { poolBands, selfControlledCaseSeries, solveLinear } from "./sccs";
import { type TimingSpec } from "./within-person";

describe("solveLinear", () => {
  test("solves a small system and refuses a singular one", () => {
    const x = solveLinear(
      [
        [2, 1],
        [1, 3],
      ],
      [3, 5],
    );
    expect(x?.[0]).toBeCloseTo(0.8, 12);
    expect(x?.[1]).toBeCloseTo(1.4, 12);
    expect(
      solveLinear(
        [
          [1, 2],
          [2, 4],
        ],
        [1, 2],
      ),
    ).toBeNull();
  });
});

describe("poolBands", () => {
  test("joins bands without events to the next one, trailing ones to the last", () => {
    const groups = poolBands(
      new Map([
        [10, 0],
        [11, 2],
        [12, 0],
        [13, 1],
        [14, 0],
      ]),
    );
    expect([...groups]).toEqual([
      [10, 0],
      [11, 0],
      [12, 1],
      [13, 1],
      [14, 1],
    ]);
  });
});

const oneBand = (afterWindowsYears: readonly number[]): TimingSpec => ({
  exposure: "af",
  outcome: "stroke",
  minAgeYears: 0,
  afterWindowsYears,
  ageBandYears: 1000,
});

/** Cases observed 2016 to 2026 with AF from 2021: equal time before and after. */
const cases = (before: number, after: number) => [
  ...Array.from({ length: before }, (_, i) =>
    person(`b${i}`, {
      observedFrom: "2016-01-01",
      onset: { af: "2021-01-01", stroke: "2018-06-01" },
    }),
  ),
  ...Array.from({ length: after }, (_, i) =>
    person(`a${i}`, {
      observedFrom: "2016-01-01",
      onset: { af: "2021-01-01", stroke: "2023-06-01" },
    }),
  ),
  person("no-stroke", { observedFrom: "2016-01-01", onset: { af: "2021-01-01" } }),
];

describe("selfControlledCaseSeries", () => {
  test("with identical periods the estimate is the ratio of events times the ratio of time", () => {
    const result = selfControlledCaseSeries(cases(10, 30), oneBand([0]));
    expect(result.cases).toBe(40);
    expect(result.eventsBefore).toBe(10);
    expect(result.converged).toBe(true);
    const before = 1827; // 2016-01-01 to 2021-01-01
    const after = 1826; // 2021-01-01 to 2026-01-01
    expect(result.windows[0]?.ratio?.ratio).toBeCloseTo((30 / 10) * (before / after), 4);
    const ci = result.windows[0]?.ratio?.ci;
    const se = Math.sqrt(1 / 10 + 1 / 30);
    expect(Math.log((ci?.high ?? 0) / (ci?.low ?? 1))).toBeCloseTo(2 * 1.959964 * se, 3);
  });

  test("no event before onset leaves every window without an estimate", () => {
    const result = selfControlledCaseSeries(cases(0, 5), oneBand([0, 2]));
    expect(result.windows.map((w) => w.ratio)).toEqual([null, null]);
    expect(result.windows.map((w) => w.events)).toEqual([0, 5]);
  });

  test("a window with no events is null while the others are estimated", () => {
    const result = selfControlledCaseSeries(cases(10, 30), oneBand([0, 1, 2]));
    expect(result.windows.map((w) => w.events)).toEqual([0, 0, 30]);
    expect(result.windows[0]?.ratio).toBeNull();
    expect(result.windows[2]?.ratio?.ratio).toBeGreaterThan(1);
  });
});
