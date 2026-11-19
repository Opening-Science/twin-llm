import { describe, expect, test } from "bun:test";

import {
  SYNTHETIC_WHOOP_PAYLOAD,
  SYNTHETIC_WINDOW,
} from "./fixtures/synthetic-sync-payload";
import { buildWhoopSummary } from "./summary";

describe("buildWhoopSummary golden", () => {
  const summary = buildWhoopSummary(SYNTHETIC_WHOOP_PAYLOAD, SYNTHETIC_WINDOW);

  test("emits exact citation keys, values and units", () => {
    expect(summary.metrics.map((m) => [m.key, m.value, m.unit ?? null])).toEqual([
      ["whoop.recovery.score.2026-01-02", 64, null],
      ["whoop.recovery.hrv.2026-01-02", 48.3, "ms"],
      ["whoop.recovery.rhr.2026-01-02", 52, "bpm"],
      ["whoop.recovery.spo2.2026-01-02", 96.4, "%"],
      ["whoop.recovery.score.2026-01-03", 40, null],
      ["whoop.cycle.strain.2026-01-01", 11.5, null],
      ["whoop.cycle.avg_hr.2026-01-01", 71, "bpm"],
      ["whoop.sleep.performance.2026-01-02", 88, "%"],
      ["whoop.sleep.efficiency.2026-01-02", 91.3, "%"],
      ["whoop.sleep.consistency.2026-01-02", 77, "%"],
      ["whoop.sleep.in_bed_min.2026-01-02", 450, "min"],
      ["whoop.workout.duration.running.2026-01-02", 46, "min"],
      ["whoop.workout.strain.running.2026-01-02", 12.3, null],
      ["whoop.workout.avg_hr.running.2026-01-02", 148, "bpm"],
      ["whoop.workout.max_hr.running.2026-01-02", 176, "bpm"],
      ["whoop.workout.kilojoules.running.2026-01-02", 2092, "kJ"],
      ["whoop.workout.distance.running.2026-01-02", 8013, "m"],
      ["whoop.workout.hr_zone_0.running.2026-01-02", 1, "min"],
      ["whoop.workout.hr_zone_1.running.2026-01-02", 5, "min"],
      ["whoop.workout.hr_zone_2.running.2026-01-02", 10, "min"],
      ["whoop.workout.hr_zone_3.running.2026-01-02", 15, "min"],
      ["whoop.workout.hr_zone_4.running.2026-01-02", 12, "min"],
      ["whoop.workout.hr_zone_5.running.2026-01-02", 3, "min"],
      ["whoop.workout.duration.running_2.2026-01-02", 30, "min"],
      ["whoop.workout.strain.running_2.2026-01-02", 6, null],
      ["whoop.workout.kilojoules.running_2.2026-01-02", 800, "kJ"],
    ]);
  });

  test("workout labels name the sport and the day", () => {
    const strain = summary.metrics.find(
      (m) => m.key === "whoop.workout.strain.running.2026-01-02",
    );
    expect(strain).toEqual({
      key: "whoop.workout.strain.running.2026-01-02",
      label: "Whoop workout strain, running (2026-01-02)",
      value: 12.3,
      date: "2026-01-02",
    });
  });

  test("unscored workouts and absent workout fields produce no metric", () => {
    const keys = summary.metrics.map((m) => m.key);
    expect(keys.some((k) => k.includes("functional_fitness"))).toBe(false);
    expect(keys).not.toContain("whoop.workout.distance.running_2.2026-01-02");
    expect(keys).not.toContain("whoop.workout.avg_hr.running_2.2026-01-02");
  });

  test("labels and dates follow the metric day", () => {
    const fields = (index: number) => {
      const metric = summary.metrics[index];
      return [
        Object.keys(metric ?? {}).sort(),
        metric?.key,
        metric?.label,
        metric?.value,
        metric?.date,
        metric?.unit,
      ];
    };
    expect(fields(0)).toEqual([
      ["date", "key", "label", "value"],
      "whoop.recovery.score.2026-01-02",
      "Whoop recovery score (2026-01-02)",
      64,
      "2026-01-02",
      undefined,
    ]);
    expect(fields(10)).toEqual([
      ["date", "key", "label", "unit", "value"],
      "whoop.sleep.in_bed_min.2026-01-02",
      "Whoop time in bed (2026-01-02)",
      450,
      "2026-01-02",
      "min",
    ]);
  });

  test("missing values are absent, never zero", () => {
    const keys = summary.metrics.map((m) => m.key);
    expect(keys).not.toContain("whoop.recovery.hrv.2026-01-03");
    expect(keys).not.toContain("whoop.recovery.rhr.2026-01-03");
    expect(keys).not.toContain("whoop.recovery.score.2026-01-04");
    // The nap (performance 50) shares the night's day of waking but is left out.
    expect(
      summary.metrics
        .filter((m) => m.key.startsWith("whoop.sleep.performance."))
        .map((m) => m.value),
    ).toEqual([88]);
  });

  test("narrative header and first cited line", () => {
    expect(summary.narrative.split("\n").slice(0, 3)).toEqual([
      "Whoop wearable context for 2026-01-01 to 2026-01-04.",
      "Cite metrics by their [key] when they inform your answer.",
      "- [whoop.recovery.score.2026-01-02] Whoop recovery score (2026-01-02): 64",
    ]);
    expect(summary.window).toEqual({ startDate: "2026-01-01", endDate: "2026-01-04" });
  });

  test("a night is keyed by the day of waking, as Oura and the CSV import key it", () => {
    const keys = summary.metrics.map((m) => m.key);
    expect(keys).toContain("whoop.sleep.performance.2026-01-02");
    expect(keys).not.toContain("whoop.sleep.performance.2026-01-01");
  });

  test("empty payload abstains with the fixed narrative", () => {
    expect(
      buildWhoopSummary(
        { recovery: [], cycles: [], sleep: [], workouts: [] },
        { startDate: "2026-01-01", endDate: "2026-01-02" },
      ),
    ).toEqual({
      window: { startDate: "2026-01-01", endDate: "2026-01-02" },
      metrics: [],
      narrative: "No Whoop metrics were available for this window.",
    });
  });
});

describe("buildWhoopSummary sleep day", () => {
  const night = (
    id: string,
    start: string,
    end: string | undefined,
    performance: number,
  ) => ({
    id,
    start,
    ...(end === undefined ? {} : { end }),
    nap: false,
    score_state: "SCORED",
    score: { sleep_performance_percentage: performance },
  });
  const sleepKeys = (sleep: ReturnType<typeof night>[]) =>
    buildWhoopSummary(
      { recovery: [], cycles: [], sleep, workouts: [] },
      { startDate: "2026-02-01", endDate: "2026-02-04" },
    ).metrics.map((m) => [m.key, m.value, m.date]);

  test("bedtimes just after and just before one UTC midnight are two nights", () => {
    expect(
      sleepKeys([
        night("early", "2026-02-02T00:10:00.000Z", "2026-02-02T07:00:00.000Z", 81),
        night("late", "2026-02-02T23:50:00.000Z", "2026-02-03T07:30:00.000Z", 74),
      ]),
    ).toEqual([
      ["whoop.sleep.performance.2026-02-02", 81, "2026-02-02"],
      ["whoop.sleep.performance.2026-02-03", 74, "2026-02-03"],
    ]);
  });

  test("a sleep with no end has no day of waking and gives no metric", () => {
    expect(sleepKeys([night("open", "2026-02-02T23:00:00.000Z", undefined, 70)])).toEqual(
      [],
    );
  });
});
