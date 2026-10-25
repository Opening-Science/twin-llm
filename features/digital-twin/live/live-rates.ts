import { metricStem, type FormattableMetric } from "@/infrastructure/format-measure";
import { VITAL_ANATOMY, type VitalId } from "@/packages/biomarkers/vitals";

/**
 * The rates that drive the live twin, as plain data, so every choice is
 * testable on synthetic objects. The Demo borrows a synthetic person's newest
 * heart and respiratory rate (B1 cohort); Self uses its own newest wearable
 * values. Nothing is ever invented: without a rate there is no motion.
 *
 * LOINC 8867-4 (heart rate) is in open-twin fhir-core LOINC_CODINGS; 9279-1
 * (respiratory rate) is what Synthea writes and what open-twin's Google Health
 * daily mapper uses.
 */
export const COHORT_VITAL_LOINCS = {
  heartRate: "8867-4",
  respiration: "9279-1",
} as const;

/** Both rates are per minute in UCUM; any other unit gives no rate. */
const PER_MINUTE = "/min";

/** Outside these a value is a data error, not something to animate. */
const PLAUSIBLE = { heart: [25, 230], breath: [3, 60], hrv: [1, 300] } as const;

export type LiveRate = Readonly<{
  perMinute: number;
  /** ISO day of the reading. */
  day: string;
  /** Who measured it: "Synthetic person 3", "Oura", "Whoop", "Google Health". */
  source: string;
  /** Which reading: heart rate or resting heart rate. */
  vital: "heartRate" | "rhr" | "respiration";
}>;

export type HrvBelowUsual = Readonly<{
  latest: number;
  median: number;
  day: string;
  source: string;
}>;

export type LiveVitals = Readonly<{
  heart: LiveRate | null;
  breath: LiveRate | null;
  /** Set only when the newest HRV is below this person's usual level (rule below). */
  hrvBelow: HrvBelowUsual | null;
}>;

export const NO_LIVE_VITALS: LiveVitals = { heart: null, breath: null, hrvBelow: null };

const plausible = (value: number, kind: keyof typeof PLAUSIBLE): boolean =>
  Number.isFinite(value) && value >= PLAUSIBLE[kind][0] && value <= PLAUSIBLE[kind][1];

export type CohortVital = Readonly<{
  loinc: string;
  value: number;
  unitUcum: string;
  effectiveAt: string;
}>;

const cohortRate = (
  vitals: readonly CohortVital[],
  loinc: string,
  kind: keyof typeof PLAUSIBLE,
  vital: LiveRate["vital"],
  person: string,
): LiveRate | null => {
  const row = vitals.find((item) => item.loinc === loinc);
  if (!row || row.unitUcum !== PER_MINUTE || !plausible(row.value, kind)) return null;
  return {
    perMinute: row.value,
    day: row.effectiveAt.slice(0, 10),
    source: person,
    vital,
  };
};

/** The Demo's rates from a synthetic person's newest cohort rows. The cohort has no HRV. */
export const cohortLiveVitals = (
  vitals: readonly CohortVital[] | null,
  person: string,
): LiveVitals =>
  vitals
    ? {
        heart: cohortRate(
          vitals,
          COHORT_VITAL_LOINCS.heartRate,
          "heart",
          "heartRate",
          person,
        ),
        breath: cohortRate(
          vitals,
          COHORT_VITAL_LOINCS.respiration,
          "breath",
          "respiration",
          person,
        ),
        hrvBelow: null,
      }
    : NO_LIVE_VITALS;

/** Stored stems by vendor prefix; Oura's carry no prefix of their own. */
export const metricSource = (stem: string): string =>
  stem.startsWith("whoop.")
    ? "Whoop"
    : stem.startsWith("google.")
      ? "Google Health"
      : "Oura";

/** Only a real calendar day counts; Whoop writes "unknown" when it has none. */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const metricDay = (metric: FormattableMetric): string | null => {
  const day = metric.date ?? /(\d{4}-\d{2}-\d{2})$/.exec(metric.key)?.[1];
  return day !== undefined && ISO_DAY.test(day) ? day : null;
};

/**
 * The units each kind is stored with, matched exactly and never converted.
 * Oura and Whoop write `bpm` and `ms`; Google Health stores the FHIR display
 * unit of the UCUM code (`per minute` for `/min`, `millisecond` for `ms`).
 */
const UNITS: Readonly<Record<keyof typeof PLAUSIBLE, ReadonlySet<string>>> = {
  heart: new Set(["bpm", "/min", "per minute"]),
  breath: new Set(["/min", "per minute"]),
  hrv: new Set(["ms", "millisecond"]),
};

type Kind = keyof typeof PLAUSIBLE;

type Point = Readonly<{
  day: string;
  value: number;
  source: string;
  key: string;
}>;

/** Oura's main sleep of the night, as opposed to a nap that day. */
const MAIN_SLEEP = ".long_sleep.";

/**
 * One vital's dated, correctly unitised, plausible readings, newest day first,
 * from the first source in the vitals table that has any. Sources are not
 * mixed, as in the Biomarkers tab.
 */
export const vitalSeries = (
  metrics: readonly FormattableMetric[],
  vital: VitalId,
  kind: Kind,
): readonly Point[] => {
  for (const stem of VITAL_ANATOMY[vital].sources) {
    const points = metrics.flatMap((metric): readonly Point[] => {
      const day = metricDay(metric);
      const value = Number(metric.value);
      if (metricStem(metric.key) !== stem || day === null) return [];
      if (metric.unit === undefined || !UNITS[kind].has(metric.unit)) return [];
      if (!plausible(value, kind)) return [];
      return [{ day, value, source: metricSource(stem), key: metric.key }];
    });
    if (points.length > 0) return [...points].sort((a, b) => b.day.localeCompare(a.day));
  }
  return [];
};

/**
 * One value per day, newest first. A day can hold several sleep periods (a
 * nap and the night): the night's reading wins; without one, the day's mean.
 * The metric key breaks a remaining tie, so the API's order never matters.
 */
export const dailyValues = (series: readonly Point[]): readonly Point[] => {
  const days = [...new Set(series.map((point) => point.day))].sort((a, b) =>
    b.localeCompare(a),
  );
  return days.map((day) => {
    const points = series
      .filter((point) => point.day === day)
      .sort((a, b) => a.key.localeCompare(b.key));
    const night = points.find((point) => point.key.includes(MAIN_SLEEP));
    if (night) return night;
    const mean = points.reduce((sum, point) => sum + point.value, 0) / points.length;
    return { ...points[0]!, value: mean };
  });
};

const wearableRate = (
  metrics: readonly FormattableMetric[],
  vital: LiveRate["vital"],
  kind: Kind,
): LiveRate | null => {
  const newest = dailyValues(vitalSeries(metrics, vital, kind))[0];
  return newest
    ? { perMinute: newest.value, day: newest.day, source: newest.source, vital }
    : null;
};

const DAY_MS = 86_400_000;
const dayNumber = (day: string): number => Date.parse(`${day}T00:00:00Z`) / DAY_MS;

/** Days before the newest reading that make up "this person's usual level". */
export const HRV_WINDOW_DAYS = 28;
export const HRV_MIN_DAYS = 14;

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/**
 * The rule: the newest day's HRV is at least 20% below the median of
 * the same person's previous 28 days (day 28 included), and those days hold
 * at least 14 readings. Relative to the person only, never a population
 * threshold; otherwise null. "20% below" is `latest × 5 ≤ usual × 4`, so no
 * floating-point 0.8 decides a boundary case.
 */
export const hrvBelowUsual = (series: readonly Point[]): HrvBelowUsual | null => {
  const [newest, ...rest] = dailyValues(series);
  if (!newest) return null;
  const today = dayNumber(newest.day);
  const window = rest.filter((point) => {
    const age = today - dayNumber(point.day);
    return age >= 1 && age <= HRV_WINDOW_DAYS;
  });
  if (window.length < HRV_MIN_DAYS) return null;
  const usual = median(window.map((point) => point.value));
  if (newest.value * 5 > usual * 4) return null;
  return { latest: newest.value, median: usual, day: newest.day, source: newest.source };
};

/** Self's rates and HRV state from its own wearable summaries. */
export const wearableLiveVitals = (
  metrics: readonly FormattableMetric[],
): LiveVitals => ({
  heart:
    wearableRate(metrics, "heartRate", "heart") ?? wearableRate(metrics, "rhr", "heart"),
  breath: wearableRate(metrics, "respiration", "breath"),
  hrvBelow: hrvBelowUsual(vitalSeries(metrics, "hrv", "hrv")),
});
