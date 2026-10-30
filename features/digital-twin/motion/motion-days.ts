import { type FormattableMetric } from "@/infrastructure/format-measure";

import { dailyValues, vitalSeries } from "../live/live-rates";
import { type DayWorkout, type MotionDay } from "./day-motion";

/**
 * A subject's recent wearable days for the twin's motion, from either data
 * path, in one shape (`MotionDay`), newest first. Pure: the route and the
 * hook do the reads.
 *
 * - Synthetic (the Demo's person): the synthetic wearable series in the
 *   warehouse (`scripts/synthetic-wearables`): `workout-<sport>` minutes, one
 *   workout a day at most, and the night's sleep (`93832-4`) and respiratory
 *   rate (`9279-1`) at 07:00 UTC. Synthea's clinic vitals share `9279-1`, so a
 *   respiratory rate counts only on a day the series has a night.
 * - A person's own exports (Self): Oura and Whoop workouts (duration and
 *   distance; no export has cadence) and the daily respiratory rate the live
 *   twin reads (`vitalSeries`).
 *
 * The window is the 28 days ending on the newest such day; only days with a
 * workout or a night are listed. A missing value stays null.
 */

export const MOTION_WINDOW_DAYS = 28;

export const SYNTHETIC_WORKOUT_SPORTS: Readonly<Record<string, string>> = {
  "workout-running": "running",
  "workout-cycling": "cycling",
  "workout-walking": "walking",
  "workout-strength": "strength",
};
export const SYNTHETIC_NIGHT_CODE = "93832-4";
export const RESPIRATION_CODE = "9279-1";

/** Every code the synthetic read asks for. */
export const MOTION_DAY_CODES: readonly string[] = [
  ...Object.keys(SYNTHETIC_WORKOUT_SPORTS),
  SYNTHETIC_NIGHT_CODE,
  RESPIRATION_CODE,
];

export type SeriesRow = Readonly<{
  loinc: string;
  value: number;
  unitUcum: string;
  /** ISO time. */
  effectiveAt: string;
}>;

const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const shiftDay = (day: string, days: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

const newestFirst = (a: string, b: string): number => b.localeCompare(a);

/** The longer workout wins; a tie keeps the first seen. */
const longer = (a: DayWorkout | undefined, b: DayWorkout): DayWorkout =>
  a && (a.minutes ?? 0) >= (b.minutes ?? 0) ? a : b;

/** Days in the window ending on the newest listed day, newest first. */
const windowed = (
  listed: ReadonlySet<string>,
  build: (day: string) => MotionDay,
): readonly MotionDay[] => {
  const days = [...listed].filter((day) => ISO_DAY.test(day)).sort(newestFirst);
  const newest = days[0];
  if (newest === undefined) return [];
  const oldest = shiftDay(newest, 1 - MOTION_WINDOW_DAYS);
  return days.filter((day) => day >= oldest).map(build);
};

const finite = (value: number): boolean => Number.isFinite(value);

/** The Demo person's days from their synthetic series rows. */
export const syntheticMotionDays = (rows: readonly SeriesRow[]): readonly MotionDay[] => {
  const nights = new Set(
    rows
      .filter((row) => row.loinc === SYNTHETIC_NIGHT_CODE && finite(row.value))
      .map((row) => row.effectiveAt.slice(0, 10)),
  );
  const workouts = new Map<string, DayWorkout>();
  for (const row of rows) {
    const sport = SYNTHETIC_WORKOUT_SPORTS[row.loinc];
    if (sport === undefined || row.unitUcum !== "min" || !finite(row.value)) continue;
    const day = row.effectiveAt.slice(0, 10);
    workouts.set(
      day,
      longer(workouts.get(day), {
        sport,
        minutes: row.value,
        distanceM: null,
        cadence: null,
      }),
    );
  }
  // The newest reading of the day, if several.
  const breaths = new Map(
    rows
      .filter(
        (row) =>
          row.loinc === RESPIRATION_CODE &&
          row.unitUcum === "/min" &&
          finite(row.value) &&
          nights.has(row.effectiveAt.slice(0, 10)),
      )
      .sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt))
      .map((row) => [row.effectiveAt.slice(0, 10), row.value] as const),
  );
  return windowed(new Set([...nights, ...workouts.keys()]), (day) => ({
    day,
    workout: workouts.get(day) ?? null,
    breathsPerMinute: breaths.get(day) ?? null,
  }));
};

/** Workout keys per export: `workout.duration.running.<day>`, `whoop.workout.distance.running_2.<day>`. */
const WORKOUT_PREFIXES: readonly (readonly string[])[] = [
  ["workout"],
  ["whoop", "workout"],
];
const FIELD_UNITS: Readonly<Record<string, string>> = { duration: "min", distance: "m" };

type Part = Readonly<{
  session: string;
  day: string;
  field: "duration" | "distance";
  value: number;
}>;

const workoutPart = (metric: FormattableMetric): Part | null => {
  const parts = metric.key.split(".");
  for (const prefix of WORKOUT_PREFIXES) {
    if (!prefix.every((part, index) => parts[index] === part)) continue;
    const [field, session, day, ...rest] = parts.slice(prefix.length);
    const value = Number(metric.value);
    if (
      (field === "duration" || field === "distance") &&
      session !== undefined &&
      day !== undefined &&
      rest.length === 0 &&
      ISO_DAY.test(day) &&
      metric.unit === FIELD_UNITS[field] &&
      finite(value)
    ) {
      return { session: `${prefix.join(".")}:${session}`, day, field, value };
    }
  }
  return null;
};

/** A second workout of a sport on one day is keyed `<sport>_2` (Whoop). */
const sportOf = (session: string): string =>
  (session.split(":")[1] ?? session).replace(/_\d+$/, "");

/** Self's days from its own wearable summaries. */
export const wearableMotionDays = (
  metrics: readonly FormattableMetric[],
): readonly MotionDay[] => {
  const sessions = new Map<
    string,
    Readonly<{ day: string; session: string }> & DayWorkout
  >();
  for (const metric of metrics) {
    const part = workoutPart(metric);
    if (!part) continue;
    const id = `${part.session}|${part.day}`;
    const known = sessions.get(id) ?? {
      day: part.day,
      session: part.session,
      sport: sportOf(part.session),
      minutes: null,
      distanceM: null,
      cadence: null,
    };
    sessions.set(id, {
      ...known,
      ...(part.field === "duration"
        ? { minutes: part.value }
        : { distanceM: part.value }),
    });
  }
  const workouts = new Map<string, DayWorkout>();
  for (const { day, sport, minutes, distanceM, cadence } of sessions.values()) {
    workouts.set(day, longer(workouts.get(day), { sport, minutes, distanceM, cadence }));
  }
  const breaths = new Map(
    dailyValues(vitalSeries(metrics, "respiration", "breath")).map(
      (point) => [point.day, point.value] as const,
    ),
  );
  return windowed(new Set([...breaths.keys(), ...workouts.keys()]), (day) => ({
    day,
    workout: workouts.get(day) ?? null,
    breathsPerMinute: breaths.get(day) ?? null,
  }));
};
