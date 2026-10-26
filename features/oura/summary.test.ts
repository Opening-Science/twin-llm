import { describe, expect, test } from "bun:test";

import { SYNTHETIC_OURA_DATA, SYNTHETIC_WINDOW } from "./fixtures/synthetic-sync-data";
import { buildOuraSummary } from "./summary";

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
