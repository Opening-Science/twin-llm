import { describe, expect, test } from "bun:test";

import { type GlucosePeriod } from "@/packages/query-tools/day-period";
import { type WearableTrendResult } from "@/packages/query-tools/wearable-analytics";

import { periodSummary, type PeriodSource } from "./period-summary";

const GLUCOSE: GlucosePeriod = {
  specimen: "blood",
  n: 31,
  days: 7,
  average_mg_dl: 103.2,
  range: { low: null, high: 140, unit: "mg/dL", thresholds: "placeholder" },
  share_of_readings: { below: null, within: 0.968, above: 0.032 },
  basis: "share of readings",
  by_day: [],
};

const trend = (slopePerWeek: number | null, recent: number, baseline: number) =>
  ({
    measure: "resting_hr",
    start: "2026-11-10",
    end: "2026-11-16",
    n: 7,
    sources: [
      {
        source: "synthetic",
        key: "40443-4",
        unit: "/min",
        n: 7,
        first_day: "2026-11-10",
        last_day: "2026-11-16",
        slope_per_day: slopePerWeek === null ? null : slopePerWeek / 7,
        slope_per_week: slopePerWeek,
        slope_unit: "/min/d",
        slope_per_week_unit: "/min/wk",
        fitted_first: null,
        fitted_last: null,
        recent: { start: "2026-11-10", end: "2026-11-16", n: 7, median: recent },
        baseline: {
          start: "2026-10-13",
          end: "2026-11-09",
          n: 28,
          median: baseline,
          mad: 1,
        },
        robust_z: null,
      },
    ],
  }) as unknown as WearableTrendResult;

const SOURCE: PeriodSource = {
  period: "week",
  start: "2026-11-10",
  end: "2026-11-16",
  profile: "without_diabetes",
  glucose: GLUCOSE,
  resting_hr: trend(-4.32, 60, 60),
  hrv: trend(5.5, 53, 45),
};

const text = (label: string, source: PeriodSource = SOURCE) =>
  periodSummary(source).lines.find((line) => line.label === label)?.text;

describe("periodSummary", () => {
  test("titles the period with its days", () => {
    expect(periodSummary(SOURCE).title).toBe("Week, 10 Nov 2026 to 16 Nov 2026");
    expect(periodSummary({ ...SOURCE, period: "month" }).title).toStartWith("30 days");
  });

  test("glucose: average, readings, days and shares of readings, never of time", () => {
    expect(text("Blood glucose")).toBe(
      "Average 103 mg/dL from 31 readings on 7 days. 97% within, 3% above the range (up to 140 mg/dL), as a share of readings, not of time.",
    );
  });

  test("with diabetes the range has both ends and a below share", () => {
    const glucose: GlucosePeriod = {
      ...GLUCOSE,
      range: { low: 70, high: 180, unit: "mg/dL", thresholds: "placeholder" },
      share_of_readings: { below: 0.1, within: 0.8, above: 0.1 },
    };
    expect(text("Blood glucose", { ...SOURCE, glucose })).toContain(
      "80% within, 10% above, 10% below the range (70–180 mg/dL)",
    );
  });

  test("no glucose is said in a sentence", () => {
    const glucose = {
      ...GLUCOSE,
      n: 0,
      days: 0,
      average_mg_dl: null,
      share_of_readings: null,
    };
    expect(text("Blood glucose", { ...SOURCE, glucose })).toBe(
      "No blood glucose readings in this period.",
    );
  });

  test("a trend reads as medians and a direction in words", () => {
    expect(text("Resting heart rate")).toBe(
      "Median 60 /min in the last 7 days, 60 /min in the 28 days before. Over the period, down about 4.3 /min a week.",
    );
    expect(text("Heart rate variability")).toContain("up about 5.5 ms a week");
  });

  test("a refused trend is a sentence, not a number", () => {
    const short = {
      code: "WINDOW_TOO_SHORT",
      error: "x",
      measure: "hrv",
      minimum: 7,
      counts: [],
    } as const;
    expect(text("Heart rate variability", { ...SOURCE, hrv: short as never })).toBe(
      "Fewer than 7 days of readings, so no trend.",
    );
  });

  test("recovery is not recorded, and the note names the range, placeholders and UTC", () => {
    expect(text("Recovery after workouts")).toContain("Not recorded");
    expect(periodSummary(SOURCE).notes).toEqual([
      "Glucose range: without diabetes, placeholder thresholds. Times are UTC.",
    ]);
  });
});
