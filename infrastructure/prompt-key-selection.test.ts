import { describe, expect, test } from "bun:test";

import { OFFERED_KEYS_PER_SOURCE } from "./offered-keys";
import { keyCategory, keyFamily, selectPromptMetrics } from "./prompt-key-selection";

type Metric = Readonly<{ key: string; label: string; value: number; date?: string }>;

const DAYS = Array.from(
  { length: 14 },
  (_, index) => `2026-07-${String(index + 1).padStart(2, "0")}`,
);
const LATEST = DAYS[DAYS.length - 1]!;

/** One metric per family per day, grouped by family the way the summary builders emit them. */
const daily = (families: readonly string[]): readonly Metric[] =>
  families.flatMap((family) =>
    DAYS.map((date) => ({ key: `${family}.${date}`, label: family, value: 1, date })),
  );

const workouts = (
  prefix: string,
  fields: readonly string[],
  sports: readonly string[],
): readonly Metric[] =>
  DAYS.flatMap((date, day) => {
    const sport = sports[day % sports.length]!;
    return fields.map((field) => ({
      key: `${prefix}.${field}.${sport}.${date}`,
      label: `${field} ${sport}`,
      value: 1,
      date,
    }));
  });

/** Shaped like `buildOuraSummary` over 14 days with a workout every day. */
const OURA: readonly Metric[] = [
  { key: "personal.age", label: "Age", value: 40 },
  ...daily([
    "sleep.score.long_sleep",
    "sleep.hrv.long_sleep",
    "sleep.hr.long_sleep",
    "sleep.duration.long_sleep",
    "sleep.efficiency.long_sleep",
    "readiness.score",
    "readiness.hrv_balance",
    "activity.score",
    "activity.steps",
    "activity.active_calories",
  ]),
  ...workouts("workout", ["duration", "calories", "distance"], ["running", "cycling"]),
  ...daily(["spo2.average", "stress.summary", "vo2max.value"]),
];

/** Shaped like `buildWhoopSummary` over 14 days with a workout every day. */
const WHOOP_WORKOUT_FIELDS = [
  "duration",
  "strain",
  "avg_hr",
  "max_hr",
  "kilojoules",
  "hr_zone_0",
  "hr_zone_1",
  "hr_zone_2",
  "hr_zone_3",
  "hr_zone_4",
  "hr_zone_5",
] as const;
const WHOOP: readonly Metric[] = [
  ...daily([
    "whoop.recovery.score",
    "whoop.recovery.hrv",
    "whoop.recovery.rhr",
    "whoop.recovery.spo2",
    "whoop.cycle.strain",
    "whoop.cycle.avg_hr",
    "whoop.sleep.performance",
    "whoop.sleep.efficiency",
    "whoop.sleep.consistency",
    "whoop.sleep.in_bed_min",
  ]),
  ...workouts("whoop.workout", WHOOP_WORKOUT_FIELDS, ["running", "weightlifting"]),
];

const keys = (metrics: readonly Metric[]): readonly string[] =>
  metrics.map((metric) => metric.key);

const byCategory = (selected: readonly string[]): Record<string, number> =>
  selected.reduce<Record<string, number>>(
    (counts, key) => ({
      ...counts,
      [keyCategory(key)]: (counts[keyCategory(key)] ?? 0) + 1,
    }),
    {},
  );

describe("keyFamily and keyCategory", () => {
  test("family drops only a trailing date", () => {
    expect(keyFamily("whoop.workout.strain.running.2026-07-14")).toBe(
      "whoop.workout.strain.running",
    );
    expect(keyFamily("personal.age")).toBe("personal.age");
  });

  test("categories across sources", () => {
    expect(
      [
        "sleep.hrv.long_sleep.2026-07-14",
        "whoop.sleep.performance.2026-07-14",
        "google.sleep.2026-07-14",
        "readiness.hrv_balance.2026-07-14",
        "whoop.recovery.hrv.2026-07-14",
        "stress.summary.2026-07-14",
        "spo2.average.2026-07-14",
        "whoop.cycle.avg_hr.2026-07-14",
        "google.daily-resting-heart-rate.2026-07-14",
        "activity.steps.2026-07-14",
        "whoop.cycle.strain.2026-07-14",
        "google.steps.2026-07-14",
        "workout.calories.running.2026-07-14",
        "whoop.workout.avg_hr.running.2026-07-14",
        "personal.age",
        "google.weight.2026-07-14",
        "vitronic.distance.waist.2026-07-14",
      ].map(keyCategory),
    ).toEqual([
      "sleep",
      "sleep",
      "sleep",
      "recovery",
      "recovery",
      "recovery",
      "heart",
      "heart",
      "heart",
      "activity",
      "activity",
      "activity",
      "workouts",
      "workouts",
      "other",
      "other",
      "other",
    ]);
  });
});

describe("selectPromptMetrics", () => {
  test("under budget, the list is returned unchanged", () => {
    const few = OURA.slice(0, 5);
    expect(selectPromptMetrics(few, OFFERED_KEYS_PER_SOURCE)).toBe(few);
  });

  test("a 14-day Oura window with daily workouts still offers the latest workout", () => {
    const selected = keys(selectPromptMetrics(OURA, OFFERED_KEYS_PER_SOURCE));
    expect(selected.length).toBe(OFFERED_KEYS_PER_SOURCE);
    expect(selected).toContain(`workout.duration.cycling.${LATEST}`);
    expect(selected).toContain(`workout.calories.cycling.${LATEST}`);
    expect(selected).toContain(`workout.distance.cycling.${LATEST}`);
    expect(selected).toContain("workout.duration.running.2026-07-13");
    expect(selected).toContain(`vo2max.value.${LATEST}`);
    expect(selected).toContain("personal.age");
    expect(selected).not.toContain("sleep.score.long_sleep.2026-07-01");
    expect(byCategory(selected)).toEqual({
      other: 1,
      sleep: 9,
      recovery: 7,
      heart: 6,
      activity: 7,
      workouts: 10,
    });
  });

  test("a 14-day Whoop window with daily workouts still offers the latest workout", () => {
    const selected = keys(selectPromptMetrics(WHOOP, OFFERED_KEYS_PER_SOURCE));
    expect(selected.length).toBe(OFFERED_KEYS_PER_SOURCE);
    expect(
      WHOOP_WORKOUT_FIELDS.map(
        (field) => `whoop.workout.${field}.weightlifting.${LATEST}`,
      ),
    ).toEqual(
      selected.filter((key) => key.startsWith("whoop.workout.") && key.endsWith(LATEST)),
    );
    expect(byCategory(selected)).toEqual({
      recovery: 6,
      heart: 3,
      activity: 2,
      sleep: 6,
      workouts: 23,
    });
  });

  test("no category starves when the budget is smaller than the families", () => {
    const selected = keys(selectPromptMetrics(OURA, 6));
    expect(selected).toEqual([
      "personal.age",
      `sleep.score.long_sleep.${LATEST}`,
      `readiness.score.${LATEST}`,
      `activity.score.${LATEST}`,
      `workout.duration.cycling.${LATEST}`,
      `spo2.average.${LATEST}`,
    ]);
  });

  test("the result keeps the summary order and is the same on every call", () => {
    const first = keys(selectPromptMetrics(WHOOP, OFFERED_KEYS_PER_SOURCE));
    const second = keys(selectPromptMetrics([...WHOOP], OFFERED_KEYS_PER_SOURCE));
    expect(second).toEqual(first);
    const order = keys(WHOOP);
    expect([...first].sort((a, b) => order.indexOf(a) - order.indexOf(b))).toEqual([
      ...first,
    ]);
  });
});
