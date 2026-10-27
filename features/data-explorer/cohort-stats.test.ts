import { describe, expect, test } from "bun:test";

import {
  type CodeUnitRow,
  cohortTotals,
  coverageSplit,
  formatShare,
  summariseCodes,
  unitLabel,
  yearSeries,
} from "./cohort-stats";

const day = (iso: string) => new Date(`${iso}T12:00:00Z`);

const unitRow = (
  loinc: string,
  unit: string,
  rows: number,
  subjects: number,
  first = "2020-01-01",
  last = "2020-12-31",
  display = `Code ${loinc}`,
): CodeUnitRow => ({
  loinc,
  display,
  unit,
  rows,
  subjects,
  first: day(first),
  last: day(last),
});

describe("summariseCodes", () => {
  test("sums rows across units, takes distinct subjects per code and sorts widest first", () => {
    const rows = [
      unitRow("2339-0", "mg/dL", 30, 8, undefined, undefined, "Glucose"),
      unitRow("5811-5", "{SG}", 4, 3, undefined, undefined, "Specific gravity"),
      unitRow("5811-5", "1", 9, 5, undefined, undefined, "Specific gravity of Urine"),
      unitRow("29463-7", "kg", 50, 10, undefined, undefined, "Body weight"),
    ];
    const codes = summariseCodes(
      rows,
      [
        { loinc: "2339-0", subjects: 8 },
        { loinc: "5811-5", subjects: 6 },
        { loinc: "29463-7", subjects: 10 },
      ],
      10,
    );
    expect(codes).toEqual([
      {
        loinc: "29463-7",
        display: "Body weight",
        units: ["kg"],
        rows: 50,
        subjects: 10,
        share: 1,
      },
      {
        loinc: "2339-0",
        display: "Glucose",
        units: ["mg/dL"],
        rows: 30,
        subjects: 8,
        share: 0.8,
      },
      {
        loinc: "5811-5",
        display: "Specific gravity of Urine",
        units: ["1", "{SG}"],
        rows: 13,
        subjects: 6,
        share: 0.6,
      },
    ]);
  });

  test("an equal share is ordered by rows, then by code", () => {
    const codes = summariseCodes(
      [unitRow("b", "kg", 5, 2), unitRow("a", "kg", 5, 2), unitRow("c", "kg", 9, 2)],
      [],
      4,
    );
    expect(codes.map((code) => code.loinc)).toEqual(["c", "a", "b"]);
    // Without a distinct-subject row, the largest unit group stands in.
    expect(codes[0]!.share).toBe(0.5);
  });

  test("an empty cohort gives a share of 0, not a division by zero", () => {
    expect(summariseCodes([unitRow("a", "kg", 1, 1)], [], 0)[0]!.share).toBe(0);
  });
});

describe("cohortTotals", () => {
  test("adds rows, counts distinct codes and spans the earliest to latest day", () => {
    expect(
      cohortTotals(
        [
          unitRow("a", "kg", 10, 2, "2015-03-04", "2019-01-01"),
          unitRow("a", "g", 2, 1, "2012-07-30", "2018-01-01"),
          unitRow("b", "mg", 5, 2, "2016-01-01", "2026-10-01"),
        ],
        3,
        42,
      ),
    ).toEqual({
      subjects: 3,
      observations: 17,
      nonNumeric: 42,
      codes: 2,
      firstDay: "2012-07-30",
      lastDay: "2026-10-01",
    });
  });

  test("no rows means no days, not day zero", () => {
    expect(cohortTotals([], 0, 0)).toEqual({
      subjects: 0,
      observations: 0,
      nonNumeric: 0,
      codes: 0,
      firstDay: null,
      lastDay: null,
    });
  });
});

describe("yearSeries", () => {
  test("fills missing years between the first and last with zero counts, in order", () => {
    expect(
      yearSeries([
        { year: 2003, rows: 7, subjects: 2 },
        { year: 2000, rows: 3, subjects: 1 },
      ]),
    ).toEqual([
      { year: 2000, rows: 3, subjects: 1 },
      { year: 2001, rows: 0, subjects: 0 },
      { year: 2002, rows: 0, subjects: 0 },
      { year: 2003, rows: 7, subjects: 2 },
    ]);
  });

  test("no rows gives no years", () => {
    expect(yearSeries([])).toEqual([]);
  });
});

describe("coverage", () => {
  const code = (loinc: string, share: number) => ({
    loinc,
    display: loinc,
    units: ["kg"],
    rows: 1,
    subjects: 1,
    share,
  });

  test("wide is at least 80% of subjects, sparse under 10%, rarest first", () => {
    const codes = [
      code("w1", 1),
      code("w2", 0.8),
      code("m", 0.5),
      code("s1", 0.09),
      code("s2", 0.01),
    ];
    const split = coverageSplit(codes);
    expect(split.wide.map((c) => c.loinc)).toEqual(["w1", "w2"]);
    expect(split.sparse.map((c) => c.loinc)).toEqual(["s2", "s1"]);
  });
});

describe("formatting", () => {
  test("shares under 10% keep one decimal; others are whole", () => {
    expect(formatShare(0.005)).toBe("0.5%");
    expect(formatShare(0.0949)).toBe("9.5%");
    expect(formatShare(0.125)).toBe("13%");
    expect(formatShare(1)).toBe("100%");
    expect(formatShare(0)).toBe("0%");
  });

  test("units join with a middle dot", () => {
    expect(unitLabel(["mg/dL"])).toBe("mg/dL");
    expect(unitLabel(["1", "{SG}"])).toBe("1 · {SG}");
  });
});
