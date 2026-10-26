import "server-only";

import type { OuraTypedData } from "@open-twin/provider-oura";

import type { OuraMetric, OuraSummary } from "@/infrastructure/oura-types";

export type { OuraMetric, OuraSummary };

/** An Oura activity name as a citation key segment: letters, digits and `_` only. */
const keyPart = (text: string): string => text.replace(/[^A-Za-z0-9]+/g, "_");

/** Whole minutes between two instants, or null when either does not parse. */
const durationMinutes = (start: string, end: string): number | null => {
  const ms = Date.parse(end) - Date.parse(start);
  return Number.isFinite(ms) ? Math.round(ms / 60_000) : null;
};

type SleepPeriod = Readonly<{
  day: string;
  type?: string | null;
  total_sleep_duration?: number | null;
}>;

/** The key segment of a day's main sleep; live rates and charts look for it. */
export const MAIN_SLEEP_SEGMENT = "long_sleep";

const sleepRank = (night: SleepPeriod): readonly [number, number] => [
  night.type === MAIN_SLEEP_SEGMENT ? 1 : 0,
  night.total_sleep_duration ?? -1,
];

const ranksAbove = (a: SleepPeriod, b: SleepPeriod): boolean => {
  const [aLong, aLength] = sleepRank(a);
  const [bLong, bLength] = sleepRank(b);
  return aLong !== bLong ? aLong > bLong : aLength > bLength;
};

/**
 * The key segment for each sleep period, or null for one deleted in Oura.
 *
 * A day can hold several periods: the night, a nap, a two-minute rest. Each
 * day's main sleep (Oura's `long_sleep`, else the longest period) is keyed
 * `long_sleep`, so the daily vitals read the night and never a short rest.
 * The others keep Oura's type (`late_nap`, `rest`, `sleep`) and are numbered
 * when one repeats on a day, so every key stays unique.
 */
export const sleepPeriods = (
  nights: readonly SleepPeriod[],
): readonly (string | null)[] => {
  const main = new Map<string, number>();
  nights.forEach((night, index) => {
    if (night.type === "deleted") return;
    const current = main.get(night.day);
    if (current === undefined || ranksAbove(night, nights[current]!)) {
      main.set(night.day, index);
    }
  });
  const seen = new Map<string, number>();
  return nights.map((night, index) => {
    if (night.type === "deleted") return null;
    if (main.get(night.day) === index) return MAIN_SLEEP_SEGMENT;
    // A second long_sleep on one day is not the main one; it must not read as it.
    const base =
      night.type === MAIN_SLEEP_SEGMENT ? "extra_sleep" : (night.type ?? "other_sleep");
    const count = (seen.get(`${night.day}:${base}`) ?? 0) + 1;
    seen.set(`${night.day}:${base}`, count);
    return count === 1 ? base : `${base}_${count}`;
  });
};

/**
 * Flattens OpenTwin typed Oura payloads into a compact, citation-friendly
 * summary for the system prompt. Prefer this over dumping FHIR into the model.
 */
export const buildOuraSummary = (
  data: readonly OuraTypedData[],
  window: { startDate: string; endDate: string },
): OuraSummary => {
  const metrics: OuraMetric[] = [];

  for (const entry of data) {
    if (entry.type === "personal_info") {
      const age = entry.data.age;
      if (typeof age === "number") {
        metrics.push({ key: "personal.age", label: "Age", value: age });
      }
      continue;
    }

    if (entry.type === "sleep") {
      const periods = sleepPeriods(entry.data.data);
      for (const [index, night] of entry.data.data.entries()) {
        const segment = periods[index];
        if (segment == null) continue;
        const day = night.day;
        const period = `.${segment}`;
        if (typeof night.score === "number") {
          metrics.push({
            key: `sleep.score${period}.${day}`,
            label: `Sleep score (${day})`,
            value: night.score,
            date: day,
          });
        }
        if (typeof night.average_hrv === "number") {
          metrics.push({
            key: `sleep.hrv${period}.${day}`,
            label: `Average HRV during sleep (${day})`,
            value: night.average_hrv,
            date: day,
            unit: "ms",
          });
        }
        if (typeof night.average_heart_rate === "number") {
          metrics.push({
            key: `sleep.hr${period}.${day}`,
            label: `Average heart rate during sleep (${day})`,
            value: night.average_heart_rate,
            date: day,
            unit: "bpm",
          });
        }
        if (typeof night.total_sleep_duration === "number") {
          metrics.push({
            key: `sleep.duration${period}.${day}`,
            label: `Total sleep duration (${day})`,
            value: Math.round(night.total_sleep_duration / 60),
            date: day,
            unit: "min",
          });
        }
        if (typeof night.efficiency === "number") {
          metrics.push({
            key: `sleep.efficiency${period}.${day}`,
            label: `Sleep efficiency (${day})`,
            value: night.efficiency,
            date: day,
            unit: "%",
          });
        }
      }
      continue;
    }

    if (entry.type === "daily_readiness") {
      for (const dayRow of entry.data.data) {
        const day = dayRow.day;
        if (typeof dayRow.score === "number") {
          metrics.push({
            key: `readiness.score.${day}`,
            label: `Readiness score (${day})`,
            value: dayRow.score,
            date: day,
          });
        }
        const hrvBalance = dayRow.contributors?.hrv_balance;
        if (typeof hrvBalance === "number") {
          metrics.push({
            key: `readiness.hrv_balance.${day}`,
            label: `HRV balance contributor (${day})`,
            value: hrvBalance,
            date: day,
          });
        }
      }
      continue;
    }

    if (entry.type === "daily_activity") {
      for (const dayRow of entry.data.data) {
        const day = dayRow.day;
        if (typeof dayRow.score === "number") {
          metrics.push({
            key: `activity.score.${day}`,
            label: `Activity score (${day})`,
            value: dayRow.score,
            date: day,
          });
        }
        if (typeof dayRow.steps === "number") {
          metrics.push({
            key: `activity.steps.${day}`,
            label: `Steps (${day})`,
            value: dayRow.steps,
            date: day,
          });
        }
        if (typeof dayRow.active_calories === "number") {
          metrics.push({
            key: `activity.active_calories.${day}`,
            label: `Active calories (${day})`,
            value: dayRow.active_calories,
            date: day,
            unit: "kcal",
          });
        }
      }
      continue;
    }

    if (entry.type === "workout") {
      for (const workout of entry.data.data) {
        const day = workout.day;
        // Several workouts can share a day, so the activity is part of the key,
        // the way a sleep period is for sleep.
        const activity = keyPart(workout.activity);
        const minutes = durationMinutes(workout.start_datetime, workout.end_datetime);
        if (minutes !== null) {
          metrics.push({
            key: `workout.duration.${activity}.${day}`,
            label: `Workout duration, ${workout.activity} (${day})`,
            value: minutes,
            date: day,
            unit: "min",
          });
        }
        if (typeof workout.calories === "number") {
          metrics.push({
            key: `workout.calories.${activity}.${day}`,
            label: `Workout calories, ${workout.activity} (${day})`,
            value: workout.calories,
            date: day,
            unit: "kcal",
          });
        }
        if (typeof workout.distance === "number") {
          metrics.push({
            key: `workout.distance.${activity}.${day}`,
            label: `Workout distance, ${workout.activity} (${day})`,
            value: workout.distance,
            date: day,
            unit: "m",
          });
        }
      }
      continue;
    }

    if (entry.type === "daily_spo2") {
      for (const night of entry.data.data) {
        const day = night.day;
        const average = night.spo2_percentage?.average;
        if (typeof average === "number") {
          metrics.push({
            key: `spo2.average.${day}`,
            label: `Nightly SpO2 average (${day})`,
            value: average,
            date: day,
            unit: "%",
          });
        }
        if (typeof night.breathing_disturbance_index === "number") {
          metrics.push({
            key: `spo2.breathing_disturbance_index.${day}`,
            label: `Breathing disturbance index (${day})`,
            value: night.breathing_disturbance_index,
            date: day,
            unit: "/h",
          });
        }
      }
      continue;
    }

    if (entry.type === "daily_stress") {
      for (const dayRow of entry.data.data) {
        const day = dayRow.day;
        if (typeof dayRow.day_summary === "string") {
          metrics.push({
            key: `stress.summary.${day}`,
            label: `Stress day summary (${day})`,
            value: dayRow.day_summary,
            date: day,
          });
        }
        if (typeof dayRow.stress_high === "number") {
          metrics.push({
            key: `stress.high.${day}`,
            label: `Time in high stress (${day})`,
            value: Math.round(dayRow.stress_high / 60),
            date: day,
            unit: "min",
          });
        }
        if (typeof dayRow.recovery_high === "number") {
          metrics.push({
            key: `stress.recovery_high.${day}`,
            label: `Time in high recovery (${day})`,
            value: Math.round(dayRow.recovery_high / 60),
            date: day,
            unit: "min",
          });
        }
      }
      continue;
    }

    if (entry.type === "vO2_max") {
      for (const reading of entry.data.data) {
        const day = reading.day;
        if (typeof reading.vo2_max === "number") {
          metrics.push({
            key: `vo2max.value.${day}`,
            label: `VO2 max (${day})`,
            value: reading.vo2_max,
            date: day,
            unit: "mL/kg/min",
          });
        }
      }
    }
  }

  const lines = metrics.slice(0, 80).map((m) => {
    const unit = m.unit ? ` ${m.unit}` : "";
    return `- [${m.key}] ${m.label}: ${m.value}${unit}`;
  });

  const narrative =
    metrics.length === 0
      ? "No Oura metrics were available for this window."
      : [
          `Oura wearable context for ${window.startDate} to ${window.endDate}.`,
          "Cite metrics by their [key] when they inform your answer.",
          ...lines,
        ].join("\n");

  return { window, metrics, narrative };
};
