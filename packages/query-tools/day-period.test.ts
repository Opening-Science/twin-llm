import { describe, expect, test } from "bun:test";

import { type DayReading } from "./day-beats";
import { glucosePeriod } from "./day-period";
import MOCK_DAY from "./fixtures/mock-day.json";

/** The illustrative mock day: hand-written values, not a recording of anyone. */
const MOCK: readonly DayReading[] = MOCK_DAY.readings.map((one) => ({
  time: one.time,
  event: one.event,
  heartRatePerMin: one.heart_rate_per_min,
  glucoseMgDl: one.glucose_mg_dl,
  moving: one.moving,
}));

const glucose = (time: string, value: number | null): DayReading => ({
  time,
  event: null,
  heartRatePerMin: 60,
  glucoseMgDl: value,
  moving: null,
});

describe("glucosePeriod on the mock day", () => {
  test("without diabetes: average 105.7 mg/dL, one reading of 14 above 140", () => {
    // Hand-checked: the 14 glucose readings sum to 1480; only 175 at 20:30 is above 140.
    const period = glucosePeriod(
      [{ day: MOCK_DAY.day, readings: MOCK }],
      "without_diabetes",
    );
    expect(period).toEqual({
      n: 14,
      days: 1,
      average_mg_dl: 105.7,
      range: { low: null, high: 140, unit: "mg/dL", thresholds: "placeholder" },
      share_of_readings: { below: null, within: 0.929, above: 0.071 },
      basis: "share of readings",
      by_day: [{ day: "2026-11-16", n: 14, average_mg_dl: 105.7, below: 0, above: 1 }],
    });
  });

  test("with diabetes: every reading inside 70–180 mg/dL", () => {
    const period = glucosePeriod(
      [{ day: MOCK_DAY.day, readings: MOCK }],
      "with_diabetes",
    );
    expect(period.range).toEqual({
      low: 70,
      high: 180,
      unit: "mg/dL",
      thresholds: "placeholder",
    });
    expect(period.share_of_readings).toEqual({ below: 0, within: 1, above: 0 });
  });
});

describe("glucosePeriod over several days", () => {
  test("pools readings across days, in day order, and skips days without glucose", () => {
    const period = glucosePeriod(
      [
        { day: "2026-11-11", readings: [glucose("08:00", 60), glucose("12:00", 200)] },
        { day: "2026-11-10", readings: [glucose("08:00", 100), glucose("12:00", 120)] },
        { day: "2026-11-12", readings: [glucose("08:00", null)] },
      ],
      "with_diabetes",
    );
    expect(period.n).toBe(4);
    expect(period.days).toBe(2);
    expect(period.average_mg_dl).toBe(120);
    expect(period.share_of_readings).toEqual({ below: 0.25, within: 0.5, above: 0.25 });
    expect(period.by_day).toEqual([
      { day: "2026-11-10", n: 2, average_mg_dl: 110, below: 0, above: 0 },
      { day: "2026-11-11", n: 2, average_mg_dl: 130, below: 1, above: 1 },
    ]);
  });

  test("a bound value is in range: 180 is within, 70 is within", () => {
    const period = glucosePeriod(
      [{ day: "2026-11-10", readings: [glucose("08:00", 70), glucose("09:00", 180)] }],
      "with_diabetes",
    );
    expect(period.share_of_readings).toEqual({ below: 0, within: 1, above: 0 });
  });

  test("no glucose at all: no average and no shares", () => {
    const period = glucosePeriod(
      [{ day: "2026-11-10", readings: [glucose("08:00", null)] }],
      "without_diabetes",
    );
    expect(period.n).toBe(0);
    expect(period.average_mg_dl).toBeNull();
    expect(period.share_of_readings).toBeNull();
    expect(period.by_day).toEqual([]);
  });
});
