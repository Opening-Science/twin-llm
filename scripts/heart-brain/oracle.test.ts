import { describe, expect, test } from "bun:test";

import { dayNumber } from "./cohort";
import {
  birthdaysOf,
  DEFAULT_VISIT_GAP_DAYS,
  expectedAfDays,
  expectedStrokes,
  MAIN,
  type OracleSubject,
  oracleSubject,
  previousVisit,
  startedShare,
} from "./oracle";
import { type StrokeInputs, strokeHazardPerDay } from "./stroke-calculator";

const d = dayNumber;

/** A man born 1950-01-01 with one BP of 140, a wellness visit each New Year. */
const subject = (
  onsets: Readonly<{ af?: string; diabetes?: string; hypertension?: string }> = {},
): OracleSubject =>
  oracleSubject(
    {
      systolic: [["2016-01-01", 140]],
      smoker: [],
      wellness: ["2019-01-01", "2020-01-01", "2021-01-01", "2022-01-01"],
    },
    { sex: "M", birth: "1950-01-01", onsets },
  );

const man: StrokeInputs = {
  sex: "M",
  ageYears: 70,
  systolic: 140,
  bpTreated: false,
  smoker: false,
  diabetes: false,
  atrialFibrillation: false,
  coronaryHeartDisease: false,
  leftVentricularHypertrophy: false,
};

describe("birthdays and age", () => {
  test("birthdays fall on the same calendar day each year", () => {
    const days = birthdaysOf("1950-01-01");
    expect(days[0]).toBe(d("1951-01-01"));
    expect(days[69]).toBe(d("2020-01-01"));
    expect(days).toHaveLength(120);
  });
});

describe("onset model", () => {
  test("the previous wellness visit, or a year back when none is recorded", () => {
    expect(previousVisit([d("2019-01-01"), d("2020-01-01")], d("2020-01-01"))).toBe(
      d("2019-01-01"),
    );
    expect(previousVisit([], d("2020-01-01"))).toBe(
      d("2020-01-01") - DEFAULT_VISIT_GAP_DAYS,
    );
  });

  test("the started share rises evenly from the visit before to the recorded day", () => {
    expect(startedShare(100, 0, 0, "lagged")).toBe(0);
    expect(startedShare(100, 0, 50, "lagged")).toBe(0.5);
    expect(startedShare(100, 0, 100, "lagged")).toBe(1);
    expect(startedShare(100, 0, 50, "recorded")).toBe(0);
    expect(startedShare(null, 0, 50, "lagged")).toBe(0);
  });
});

describe("expectedStrokes", () => {
  const from = d("2020-01-01");
  const to = d("2021-01-01");

  test("a year at age 70 with no AF is 366 days of the calculator's daily hazard", () => {
    expect(expectedStrokes(subject(), from, to)).toBeCloseTo(
      366 * strokeHazardPerDay(man),
      12,
    );
  });

  test("AF on the whole year uses the AF points; switched off it does not", () => {
    const withAf = subject({ af: "2019-06-01" });
    const on = expectedStrokes(withAf, from, to);
    expect(on).toBeCloseTo(
      366 * strokeHazardPerDay({ ...man, atrialFibrillation: true }),
      12,
    );
    expect(expectedStrokes(withAf, from, to, { ...MAIN, af: "off" })).toBeCloseTo(
      366 * strokeHazardPerDay(man),
      12,
    );
    // 13 points (0.15) against 9 (0.08): the planted ratio here is close to 0.15/0.08.
    expect(on / expectedStrokes(withAf, from, to, { ...MAIN, af: "off" })).toBeCloseTo(
      Math.log(0.85) / Math.log(0.92),
      2,
    );
  });

  test("lagged AF is half on, on average, over the year before a recorded onset", () => {
    const recordedNextYear = subject({ af: "2021-01-01" });
    const lagged = expectedStrokes(recordedNextYear, from, to);
    const off = 366 * strokeHazardPerDay(man);
    const on = 366 * strokeHazardPerDay({ ...man, atrialFibrillation: true });
    expect(lagged).toBeGreaterThan(off);
    expect(lagged).toBeLessThan(on);
    expect((lagged - off) / (on - off)).toBeCloseTo(0.5, 2);
    // Started on the recorded day: only that last day has AF.
    expect(
      expectedStrokes(recordedNextYear, from, to, { ...MAIN, onsets: "recorded" }),
    ).toBeCloseTo((365 * off + on) / 366, 12);
    expect(expectedAfDays(recordedNextYear, from, to)).toBeCloseTo(183.5, 6);
  });

  test("the treated BP table applies from the hypertension onset when asked", () => {
    const hypertensive = subject({ hypertension: "2019-01-01" });
    expect(
      expectedStrokes(hypertensive, from, to, {
        ...MAIN,
        bpTreated: "from hypertension onset",
      }),
    ).toBeCloseTo(366 * strokeHazardPerDay({ ...man, bpTreated: true }), 12);
  });

  test("no BP on record means no stroke chance; an empty span gives 0", () => {
    const noBp = { ...subject(), systolic: [] };
    expect(expectedStrokes(noBp, from, to)).toBe(0);
    expect(expectedStrokes(subject(), to, from)).toBe(0);
  });

  test("the hazard steps up on the birthday that adds an age point", () => {
    // At 72 a man has 5 age points (69 to 73), at 74 he has 6 (73 to 76).
    const a = expectedStrokes(subject(), d("2022-06-01"), d("2022-06-02"));
    const b = expectedStrokes(subject(), d("2024-06-01"), d("2024-06-02"));
    expect(a).toBeCloseTo(strokeHazardPerDay({ ...man, ageYears: 72 }), 15);
    expect(b).toBeCloseTo(strokeHazardPerDay({ ...man, ageYears: 74 }), 15);
    expect(b).toBeGreaterThan(a);
  });
});
