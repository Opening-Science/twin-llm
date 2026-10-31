import { describe, expect, test } from "bun:test";

import golden from "./stroke-calculator.golden.json";
import {
  indexInRangeList,
  riskPerTimestep,
  strokeChancePerCheck,
  strokeHazardPerDay,
  type StrokeInputs,
  strokePoints,
  strokeTenYearRisk,
} from "./stroke-calculator";

const man70: StrokeInputs = {
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

describe("indexInRangeList", () => {
  const ages = [54, 57, 60, 63, 66, 69, 73];

  test("a value on a boundary takes the lower index, as the Java loop does", () => {
    expect(indexInRangeList(57, ages)).toBe(0);
    expect(indexInRangeList(58, ages)).toBe(1);
    expect(indexInRangeList(69, ages)).toBe(4);
  });

  test("past the last entry gives the last index; below the first throws", () => {
    expect(indexInRangeList(90, ages)).toBe(6);
    expect(() => indexInRangeList(10, ages)).toThrow();
  });
});

describe("strokeTenYearRisk", () => {
  test("a man of 70 with 140 mmHg has 9 points, a 10-year risk of 0.08", () => {
    // 70 lies in 69..73, index 5; 140 lies in 136..146, index 4: 9 points, 0.08.
    expect(strokePoints(man70)).toBe(9);
    expect(strokeTenYearRisk(man70)).toBe(0.08);
  });

  test("AF adds 4 points for a man and 6 for a woman", () => {
    expect(strokePoints({ ...man70, atrialFibrillation: true })).toBe(13);
    expect(strokeTenYearRisk({ ...man70, atrialFibrillation: true })).toBe(0.15);
    const woman = { ...man70, sex: "F" as const };
    expect(
      strokePoints({ ...woman, atrialFibrillation: true }) - strokePoints(woman),
    ).toBe(6);
  });

  test("under 55 only age and sex count, so AF changes nothing", () => {
    const young = { ...man70, ageYears: 50 };
    expect(strokeTenYearRisk(young)).toBe(0.019);
    expect(strokeTenYearRisk({ ...young, atrialFibrillation: true })).toBe(0.019);
    expect(strokeTenYearRisk({ ...young, ageYears: 30, sex: "F" })).toBe(0.007);
  });

  test("under 20, or with no BP, the calculator gives -1 and no stroke chance", () => {
    expect(strokeTenYearRisk({ ...man70, ageYears: 19 })).toBe(-1);
    expect(strokeTenYearRisk({ ...man70, systolic: null })).toBe(-1);
    expect(strokeChancePerCheck({ ...man70, ageYears: 19 })).toBe(0);
  });

  test("points past the table take its last value", () => {
    const worst: StrokeInputs = {
      ...man70,
      ageYears: 90,
      systolic: 250,
      smoker: true,
      diabetes: true,
      atrialFibrillation: true,
      coronaryHeartDisease: true,
      leftVentricularHypertrophy: true,
    };
    expect(strokeTenYearRisk(worst)).toBe(0.88);
  });

  test("BP is truncated to whole mmHg before the lookup", () => {
    expect(strokePoints({ ...man70, systolic: 146.9 })).toBe(strokePoints(man70));
    expect(strokePoints({ ...man70, systolic: 147 })).toBe(strokePoints(man70) + 1);
  });
});

describe("per check and per day", () => {
  test("a 10-year risk becomes the 7-day risk, checked once per 30 days", () => {
    expect(riskPerTimestep(0.08)).toBeCloseTo(1 - 0.92 ** (7 / 3650), 15);
    expect(strokeHazardPerDay(man70)).toBeCloseTo(riskPerTimestep(0.08) / 30, 15);
  });
});

type GoldenRow = [
  "M" | "F",
  number,
  number,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  number,
  number,
];

describe("against the Synthea v4.0.0 jar", () => {
  const rows = golden as GoldenRow[];

  test("600 cases from StrokeCalculatorGolden.java agree exactly", () => {
    expect(rows.length).toBe(600);
    const misses = rows.filter((row) => {
      const [
        sex,
        age,
        systolic,
        bpTreated,
        smoker,
        diabetes,
        af,
        chd,
        lvh,
        tenYear,
        step,
      ] = row;
      const input: StrokeInputs = {
        sex,
        ageYears: age,
        systolic,
        bpTreated,
        smoker,
        diabetes,
        atrialFibrillation: af,
        coronaryHeartDisease: chd,
        leftVentricularHypertrophy: lvh,
      };
      const ours = strokeTenYearRisk(input);
      // The jar's perTimestep result returns -1 unconverted under 20.
      const ourStep = ours === -1 ? -1 : riskPerTimestep(ours);
      return ours !== tenYear || Math.abs(ourStep - step) > 1e-15;
    });
    expect(misses).toEqual([]);
  });
});
