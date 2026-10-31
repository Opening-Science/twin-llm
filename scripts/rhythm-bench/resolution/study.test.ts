import { describe, expect, test } from "bun:test";

import { type Interval, MS } from "./aggregate";
import {
  aurocCell,
  baselineMedians,
  dailyEffects,
  type DayRow,
  HOUR_BINS,
  hourRows,
  type HourRow,
  scoredDays,
  scoredHours,
  subjectDays,
} from "./study";

const day = (
  subject: string,
  index: number,
  kind: DayRow["kind"],
  burden: number,
  heartRate: number | null,
  extra: Partial<DayRow["features"]> = {},
): DayRow => ({
  subject,
  day: index,
  kind,
  burden,
  afShare: burden,
  noise: "none",
  features: { "unit.heart_rate": heartRate, ...extra },
});

const ROWS: DayRow[] = [
  day("a", 0, "baseline", 0, 60, { "day.resting_heart_rate": 50, "day.hrv_rmssd": 40 }),
  day("a", 1, "baseline", 0, 62, { "day.resting_heart_rate": 52, "day.hrv_rmssd": 40 }),
  day("a", 2, "sinus", 0, 61, { "day.resting_heart_rate": 51, "day.hrv_rmssd": 40 }),
  day("a", 3, "af", 0.1, 65, { "day.resting_heart_rate": 51, "day.hrv_rmssd": 60 }),
  day("b", 0, "baseline", 0, 80, { "day.resting_heart_rate": 70, "day.hrv_rmssd": 20 }),
  day("b", 1, "baseline", 0, null),
  day("b", 2, "sinus", 0, 82, { "day.resting_heart_rate": 70, "day.hrv_rmssd": 20 }),
  day("b", 3, "af", 0.1, 83, { "day.resting_heart_rate": 74, "day.hrv_rmssd": 30 }),
];

describe("subjectDays", () => {
  test("baseline, sinus, then one AF day per burden, numbered in order", () => {
    expect(subjectDays({ baselineDays: 1, sinusDays: 2, burdens: [0.1, 0.5] })).toEqual([
      { day: 0, kind: "baseline", burden: 0 },
      { day: 1, kind: "sinus", burden: 0 },
      { day: 2, kind: "sinus", burden: 0 },
      { day: 3, kind: "af", burden: 0.1 },
      { day: 4, kind: "af", burden: 0.5 },
    ]);
  });
});

describe("baselineMedians and scoredDays", () => {
  test("median of the baseline days with a value", () => {
    expect([...baselineMedians(ROWS, "unit.heart_rate").entries()]).toEqual([
      ["a", 61],
      ["b", 80],
    ]);
  });

  test("absolute keeps the value; change subtracts the subject's baseline", () => {
    expect(scoredDays(ROWS, "unit.heart_rate", "absolute", "all")).toEqual([
      { cluster: "a", positive: false, score: 61 },
      { cluster: "a", positive: true, score: 65 },
      { cluster: "b", positive: false, score: 82 },
      { cluster: "b", positive: true, score: 83 },
    ]);
    expect(scoredDays(ROWS, "unit.heart_rate", "change", 0.1)).toEqual([
      { cluster: "a", positive: false, score: 0 },
      { cluster: "a", positive: true, score: 4 },
      { cluster: "b", positive: false, score: 2 },
      { cluster: "b", positive: true, score: 3 },
    ]);
    expect(scoredDays(ROWS, "unit.heart_rate", "change", 0.5)).toEqual([
      { cluster: "a", positive: false, score: 0 },
      { cluster: "b", positive: false, score: 2 },
    ]);
  });
});

describe("aurocCell", () => {
  test("counts, clusters and the AUROC on all rows", () => {
    const cell = aurocCell(
      scoredDays(ROWS, "unit.heart_rate", "absolute", "all"),
      0,
      1,
      "k",
    );
    // Pairs: 65>61, 65<82, 83>61, 83>82 = 3 of 4.
    expect(cell).toEqual({
      positives: 2,
      negatives: 2,
      clusters: 2,
      auroc: { value: 0.75, ci95: { low: null, high: null } },
    });
    expect(
      aurocCell(scoredDays(ROWS, "unit.heart_rate", "change", "all"), 0, 1, "k").auroc
        .value,
    ).toBe(1);
  });
});

describe("dailyEffects", () => {
  test("median change from baseline on sinus and AF days", () => {
    expect(
      dailyEffects(ROWS, {
        noise: [{ id: "none", dropShare: 0, spuriousShare: 0, jitterSdMs: 0 }],
        burdens: [0.1],
      }),
    ).toEqual([
      {
        noise: "none",
        burden: 0,
        days: 2,
        heartRateChange: 1,
        restingHeartRateChange: 0,
        hrvRmssdRatio: 1,
        afShare: 0,
      },
      {
        noise: "none",
        burden: 0.1,
        days: 2,
        heartRateChange: 3.5,
        restingHeartRateChange: 2,
        hrvRmssdRatio: 1.5,
        afShare: 0.1,
      },
    ]);
  });
});

describe("hourRows and scoredHours", () => {
  test("hours under half covered are left out; AF share per hour", () => {
    const intervals: Interval[] = [
      ...Array.from({ length: 3600 }, (_, i) => ({
        endMs: (i + 1) * 1000,
        rrMs: 1000,
        af: i >= 3240,
        run: 0,
      })),
      { endMs: MS.hour + 5000, rrMs: 1000, af: false, run: 0 },
    ];
    const rows = hourRows("r", intervals, "none");
    // The beat at exactly 1 h opens hour 1, which has 2 s of intervals and is dropped.
    expect(rows.map((row) => [row.hour, row.afShare])).toEqual([[0, 359 / 3599]]);
  });

  test("bins: AF hours by share against AF-free hours", () => {
    const hour = (afShare: number, score: number): HourRow => ({
      cluster: "r",
      hour: 0,
      afShare,
      noise: "none",
      features: { "unit.nrmssd": score },
    });
    const rows = [hour(0, 0.01), hour(0.03, 0.05), hour(0.5, 0.2), hour(1, 0.3)];
    const bin = (id: string) => HOUR_BINS.find((each) => each.id === id) ?? HOUR_BINS[0];
    expect(scoredHours(rows, "unit.nrmssd", bin("0-5%")).map((row) => row.score)).toEqual(
      [0.01, 0.05],
    );
    expect(
      scoredHours(rows, "unit.nrmssd", bin("70-100%")).map((row) => row.score),
    ).toEqual([0.01, 0.3]);
    expect(scoredHours(rows, "unit.nrmssd", bin("any")).length).toBe(4);
  });
});
