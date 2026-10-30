import { describe, expect, test } from "bun:test";

import { type FormattableMetric } from "@/infrastructure/format-measure";

import { type SeriesRow, syntheticMotionDays, wearableMotionDays } from "./motion-days";

const row = (loinc: string, value: number, unitUcum: string, at: string): SeriesRow => ({
  loinc,
  value,
  unitUcum,
  effectiveAt: at,
});

describe("syntheticMotionDays", () => {
  test("lists night and workout days newest first, the night's breathing only on a series night", () => {
    const rows = [
      row("93832-4", 431, "min", "2026-09-27T07:00:00.000Z"),
      row("93832-4", 402, "min", "2026-09-28T07:00:00.000Z"),
      row("9279-1", 14.2, "/min", "2026-09-28T07:00:00.000Z"),
      row("9279-1", 13.1, "/min", "2026-09-27T07:00:00.000Z"),
      // A clinic visit's rate on a day without a series night is not a night's rate.
      row("9279-1", 18, "/min", "2026-01-05T10:00:00.000Z"),
      row("workout-running", 42, "min", "2026-09-28T18:00:00.000Z"),
      row("workout-strength", 45, "min", "2026-09-26T18:00:00.000Z"),
    ];
    expect(syntheticMotionDays(rows)).toEqual([
      {
        day: "2026-09-28",
        workout: { sport: "running", minutes: 42, distanceM: null, cadence: null },
        breathsPerMinute: 14.2,
      },
      { day: "2026-09-27", workout: null, breathsPerMinute: 13.1 },
      {
        day: "2026-09-26",
        workout: { sport: "strength", minutes: 45, distanceM: null, cadence: null },
        breathsPerMinute: null,
      },
    ]);
  });

  test("keeps the 28 days ending on the newest, and nothing without series rows", () => {
    const rows = [
      row("93832-4", 431, "min", "2026-10-01T07:00:00.000Z"),
      row("93832-4", 431, "min", "2026-09-04T07:00:00.000Z"),
      row("93832-4", 431, "min", "2026-09-03T07:00:00.000Z"),
    ];
    expect(syntheticMotionDays(rows).map((item) => item.day)).toEqual([
      "2026-10-01",
      "2026-09-04",
    ]);
    expect(
      syntheticMotionDays([row("9279-1", 18, "/min", "2026-01-05T10:00:00.000Z")]),
    ).toEqual([]);
  });

  test("a workout in another unit is not read", () => {
    expect(
      syntheticMotionDays([row("workout-running", 0.7, "h", "2026-09-28T18:00:00.000Z")]),
    ).toEqual([]);
  });
});

const metric = (
  key: string,
  value: number,
  unit: string,
  date: string,
): FormattableMetric => ({
  key,
  value,
  unit,
  date,
});

describe("wearableMotionDays", () => {
  test("joins duration and distance per workout, keeps the longest of the day, and adds breathing", () => {
    const metrics = [
      metric("workout.duration.running.2026-10-20", 31, "min", "2026-10-20"),
      metric("workout.distance.running.2026-10-20", 5230, "m", "2026-10-20"),
      metric("whoop.workout.duration.walking.2026-10-20", 20, "min", "2026-10-20"),
      metric("whoop.workout.duration.cycling.2026-10-19", 60, "min", "2026-10-19"),
      metric("whoop.workout.duration.cycling_2.2026-10-19", 75, "min", "2026-10-19"),
      metric("google.daily-respiratory-rate.2026-10-20", 15.1, "/min", "2026-10-20"),
      metric("google.daily-respiratory-rate.2026-10-18", 14.4, "/min", "2026-10-18"),
      // Calories are not read, and a duration in hours is refused.
      metric("workout.calories.running.2026-10-20", 380, "kcal", "2026-10-20"),
      metric("workout.duration.yoga.2026-10-17", 1, "h", "2026-10-17"),
    ];
    expect(wearableMotionDays(metrics)).toEqual([
      {
        day: "2026-10-20",
        workout: { sport: "running", minutes: 31, distanceM: 5230, cadence: null },
        breathsPerMinute: 15.1,
      },
      {
        day: "2026-10-19",
        workout: { sport: "cycling", minutes: 75, distanceM: null, cadence: null },
        breathsPerMinute: null,
      },
      { day: "2026-10-18", workout: null, breathsPerMinute: 14.4 },
    ]);
  });

  test("no workouts and no breathing give no days", () => {
    expect(
      wearableMotionDays([metric("sleep.score.2026-10-20", 80, "score", "2026-10-20")]),
    ).toEqual([]);
  });
});
