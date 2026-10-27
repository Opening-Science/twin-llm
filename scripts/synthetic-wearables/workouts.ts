/**
 * Deterministic workouts for one synthetic subject, beside the daily series.
 *
 * Made up by a seeded generator, like the series: none comes from a device or
 * a person. At most one workout a day, only on a day the series has readings
 * (the device was worn), with a sport and its minutes. The streams are their
 * own (`workout-profile:` and `workouts:` keys), so adding workouts changed no
 * number of the daily series. Pure: no I/O, no clock.
 */
import { normal, randomFor } from "./random";
import { type DailyReading, SYNTHETIC_WEARABLE_SYSTEM, windowDays } from "./series";

const workoutMetric = (sport: string) =>
  ({
    system: SYNTHETIC_WEARABLE_SYSTEM,
    code: `workout-${sport}`,
    display: `Workout duration, ${sport} (synthetic)`,
    unit: "min",
    unitLabel: "minute",
    time: "18:00:00",
    category: "activity",
  }) as const;

/** No LOINC code holds a workout's sport, so each sport has a local code; the value is minutes. */
export const WORKOUT_METRICS = {
  workout_running: workoutMetric("running"),
  workout_cycling: workoutMetric("cycling"),
  workout_walking: workoutMetric("walking"),
  workout_strength: workoutMetric("strength"),
} as const;

export type WorkoutMetric = keyof typeof WORKOUT_METRICS;

export const WORKOUT_METRIC_NAMES = Object.keys(WORKOUT_METRICS) as WorkoutMetric[];

/** Typical minutes per sport, before the day's noise. */
const BASE_MINUTES: Readonly<Record<WorkoutMetric, number>> = {
  workout_running: 40,
  workout_cycling: 60,
  workout_walking: 45,
  workout_strength: 45,
};

export type WorkoutReading = Readonly<{
  day: string;
  metric: WorkoutMetric;
  value: number;
}>;

export type WorkoutProfile = Readonly<{
  /** Share of worn days with a workout. */
  rate: number;
  /** The sport most of them are. */
  usual: WorkoutMetric;
}>;

export const workoutProfile = (seed: number, subjectRef: string): WorkoutProfile => {
  const random = randomFor(seed, `workout-profile:${subjectRef}`);
  const rate = random();
  const usual = random();
  return {
    rate: Math.round((0.15 + 0.45 * rate) * 1000) / 1000,
    usual:
      WORKOUT_METRIC_NAMES[Math.floor(usual * WORKOUT_METRIC_NAMES.length)] ??
      "workout_walking",
  };
};

type WorkoutOptions = Readonly<{
  seed: number;
  subjectRef: string;
  endDay: string;
  days: number;
}>;

/**
 * One subject's workouts over the window. Every day draws the same five
 * values whether or not it has a workout, so one day never shifts another.
 * `series` is that subject's daily series: a day without readings gets none.
 */
export const generateWorkouts = (
  options: WorkoutOptions,
  series: readonly DailyReading[],
): WorkoutReading[] => {
  const profile = workoutProfile(options.seed, options.subjectRef);
  const random = randomFor(options.seed, `workouts:${options.subjectRef}`);
  const worn = new Set(series.map((reading) => reading.day));
  return windowDays(options.endDay, options.days).flatMap((day) => {
    const happens = random() < profile.rate;
    const usual = random() < 0.6;
    const other = random();
    const noise = normal(random);
    if (!happens || !worn.has(day)) return [];
    const metric = usual
      ? profile.usual
      : (WORKOUT_METRIC_NAMES[Math.floor(other * WORKOUT_METRIC_NAMES.length)] ??
        profile.usual);
    const minutes = Math.round(
      Math.min(150, Math.max(10, BASE_MINUTES[metric] + 12 * noise)),
    );
    return [{ day, metric, value: minutes }];
  });
};
