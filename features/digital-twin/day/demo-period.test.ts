import { describe, expect, test } from "bun:test";

import { type CohortRow } from "../biomarkers/cohort-handler";
import { demoPeriod } from "./demo-period";

const day = (offset: number) => {
  const at = new Date(Date.UTC(2026, 10, 16 - offset, 7));
  return at;
};

/** Made-up synthetic rows: 40 days of resting heart rate and HRV, a week of glucose. */
const ROWS: readonly CohortRow[] = [
  ...Array.from({ length: 40 }, (_, i) => ({
    id: `rhr-${i}`,
    loinc: "40443-4",
    value: 60 + (i % 3),
    unitUcum: "/min",
    effectiveAt: day(i),
  })),
  ...Array.from({ length: 40 }, (_, i) => ({
    id: `hrv-${i}`,
    loinc: "hrv-rmssd",
    value: 45 + (i % 5),
    unitUcum: "ms",
    effectiveAt: day(i),
  })),
  ...Array.from({ length: 10 }, (_, i) => ({
    id: `gl-${i}`,
    loinc: "2339-0",
    value: i === 0 ? 160 : 100,
    unitUcum: "mg/dL",
    effectiveAt: day(i),
  })),
];

describe("demoPeriod", () => {
  test("summarises the week ending on the day with show_my_period's functions", () => {
    const result = demoPeriod(ROWS, "week", "2026-11-16", "without_diabetes");
    if (result.kind !== "period") throw new Error("expected a period");
    expect(result.summary.start).toBe("2026-11-10");
    const glucose = result.summary.lines.find((line) => line.label === "Blood glucose");
    // Seven of the ten glucose days fall in the week; one is past 140.
    expect(glucose?.text).toContain("from 7 readings on 7 days");
    expect(glucose?.text).toContain("86% within, 14% above");
    // Rows read, as show_my_period counts them: the 35 compared days of every code.
    expect(result.rowsUsed).toBe(35 + 35 + 10);
  });

  test("a month covers 30 days", () => {
    const result = demoPeriod(ROWS, "month", "2026-11-16", "with_diabetes");
    if (result.kind !== "period") throw new Error("expected a period");
    expect(result.summary.start).toBe("2026-10-18");
  });

  test("refuses glucose in another unit", () => {
    const mmol: CohortRow = {
      id: "mmol",
      loinc: "2339-0",
      value: 5.5,
      unitUcum: "mmol/L",
      effectiveAt: day(1),
    };
    expect(demoPeriod([...ROWS, mmol], "week", "2026-11-16", "without_diabetes")).toEqual(
      {
        kind: "refused",
        reason: "units",
      },
    );
  });
});
