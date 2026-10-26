import { describe, expect, test } from "bun:test";

import { SYNTHETIC_OURA_DATA, SYNTHETIC_WINDOW } from "./fixtures/synthetic-sync-data";
import { buildOuraSummary, sleepPeriods } from "./summary";

describe("buildOuraSummary workouts, SpO2, stress and VO2max", () => {
  const summary = buildOuraSummary(SYNTHETIC_OURA_DATA, SYNTHETIC_WINDOW);

  test("emits exact citation keys, values and units", () => {
    expect(summary.metrics.map((m) => [m.key, m.value, m.unit ?? null])).toEqual([
      ["workout.duration.running.2026-01-02", 45, "min"],
      ["workout.calories.running.2026-01-02", 412, "kcal"],
      ["workout.distance.running.2026-01-02", 7250, "m"],
      ["workout.duration.walking.2026-01-03", 30, "min"],
      ["spo2.average.2026-01-02", 96.8, "%"],
      ["spo2.breathing_disturbance_index.2026-01-02", 3, "/h"],
      ["stress.summary.2026-01-02", "normal", null],
      ["stress.high.2026-01-02", 90, "min"],
      ["stress.recovery_high.2026-01-02", 30, "min"],
      ["vo2max.value.2026-01-02", 41.5, "mL/kg/min"],
    ]);
  });

  test("labels and dates follow the record day", () => {
    expect(summary.metrics[0]).toEqual({
      key: "workout.duration.running.2026-01-02",
      label: "Workout duration, running (2026-01-02)",
      value: 45,
      date: "2026-01-02",
      unit: "min",
    });
    expect(summary.metrics[6]).toEqual({
      key: "stress.summary.2026-01-02",
      label: "Stress day summary (2026-01-02)",
      value: "normal",
      date: "2026-01-02",
    });
    expect(summary.metrics[9]).toEqual({
      key: "vo2max.value.2026-01-02",
      label: "VO2 max (2026-01-02)",
      value: 41.5,
      date: "2026-01-02",
      unit: "mL/kg/min",
    });
  });

  test("a missing field stays absent, never zero", () => {
    const keys = summary.metrics.map((m) => m.key);
    expect(keys.filter((key) => key.endsWith(".2026-01-03"))).toEqual([
      "workout.duration.walking.2026-01-03",
    ]);
    expect(keys).not.toContain("workout.calories.walking.2026-01-03");
    expect(keys).not.toContain("workout.distance.walking.2026-01-03");
    expect(keys).not.toContain("spo2.average.2026-01-03");
    expect(keys).not.toContain("spo2.breathing_disturbance_index.2026-01-03");
    expect(keys).not.toContain("stress.summary.2026-01-03");
    expect(keys).not.toContain("stress.high.2026-01-03");
    expect(keys).not.toContain("vo2max.value.2026-01-03");
  });

  test("narrative cites each metric with its unit", () => {
    expect(summary.narrative.split("\n").slice(0, 3)).toEqual([
      "Oura wearable context for 2026-01-01 to 2026-01-04.",
      "Cite metrics by their [key] when they inform your answer.",
      "- [workout.duration.running.2026-01-02] Workout duration, running (2026-01-02): 45 min",
    ]);
    expect(summary.narrative.split("\n").at(-1)).toBe(
      "- [vo2max.value.2026-01-02] VO2 max (2026-01-02): 41.5 mL/kg/min",
    );
  });
});

const sleepPeriod = (
  id: string,
  day: string,
  type: "long_sleep" | "rest" | "deleted" | "sleep" | "late_nap",
  minutes: number,
) => ({
  id,
  day,
  type,
  bedtime_start: `${day}T00:00:00+00:00`,
  bedtime_end: `${day}T08:00:00+00:00`,
  total_sleep_duration: minutes * 60,
  average_heart_rate: type === "long_sleep" ? 54 : 70,
});

describe("buildOuraSummary sleep periods", () => {
  // Synthetic: a 2-minute rest listed before a 7 h 12 min night, then a day
  // with no long_sleep, two short periods of one type and a deleted one.
  const summary = buildOuraSummary(
    [
      {
        type: "sleep",
        data: {
          next_token: null,
          data: [
            sleepPeriod("p1", "2026-01-02", "rest", 2),
            sleepPeriod("p2", "2026-01-02", "long_sleep", 432),
            sleepPeriod("p3", "2026-01-02", "late_nap", 25),
            sleepPeriod("p4", "2026-01-03", "sleep", 40),
            sleepPeriod("p5", "2026-01-03", "sleep", 310),
            sleepPeriod("p6", "2026-01-03", "sleep", 15),
            sleepPeriod("p7", "2026-01-03", "deleted", 500),
          ],
        },
      },
    ],
    SYNTHETIC_WINDOW,
  );

  test("each day's main sleep is keyed long_sleep; naps and rests keep their type", () => {
    expect(
      summary.metrics
        .filter((m) => m.key.startsWith("sleep.duration."))
        .map((m) => [m.key, m.value]),
    ).toEqual([
      ["sleep.duration.rest.2026-01-02", 2],
      ["sleep.duration.long_sleep.2026-01-02", 432],
      ["sleep.duration.late_nap.2026-01-02", 25],
      ["sleep.duration.sleep.2026-01-03", 40],
      ["sleep.duration.long_sleep.2026-01-03", 310],
      ["sleep.duration.sleep_2.2026-01-03", 15],
    ]);
  });

  test("every metric of a period follows its key", () => {
    expect(
      summary.metrics.filter((m) => m.key.startsWith("sleep.hr.")).map((m) => m.key),
    ).toEqual([
      "sleep.hr.rest.2026-01-02",
      "sleep.hr.long_sleep.2026-01-02",
      "sleep.hr.late_nap.2026-01-02",
      "sleep.hr.sleep.2026-01-03",
      "sleep.hr.long_sleep.2026-01-03",
      "sleep.hr.sleep_2.2026-01-03",
    ]);
  });
});

describe("sleepPeriods", () => {
  test("a second long_sleep on a day is not the main one", () => {
    expect(
      sleepPeriods([
        { day: "2026-01-02", type: "long_sleep", total_sleep_duration: 3600 },
        { day: "2026-01-02", type: "long_sleep", total_sleep_duration: 7200 },
        { day: "2026-01-02", type: null, total_sleep_duration: 60 },
        { day: "2026-01-02", type: "deleted", total_sleep_duration: 9000 },
      ]),
    ).toEqual(["extra_sleep", "long_sleep", "other_sleep", null]);
  });

  test("without a long_sleep or durations, the first period is the main one", () => {
    expect(
      sleepPeriods([
        { day: "2026-01-02", type: "rest" },
        { day: "2026-01-02", type: "rest" },
      ]),
    ).toEqual(["long_sleep", "rest"]);
  });
});
