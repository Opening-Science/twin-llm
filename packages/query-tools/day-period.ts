import { type GlucoseSpecimen } from "./day-beat";
import {
  DAY_THRESHOLDS,
  type DayReading,
  type DayThresholds,
  type GlucoseProfile,
} from "./day-beats";

/**
 * Glucose over a week or a month: average, and the share of readings below,
 * within and above the profile's range from `day-thresholds.json`
 * (placeholders for Robin). Pure, free of I/O. One specimen at a time: blood
 * glucose, or sensor glucose from a continuous monitor, never the two pooled.
 *
 * "Time in range" here is the share of readings. It equals the share of time
 * only when readings are evenly spaced, as a continuous monitor's are; the
 * result says which it is.
 */

export type PeriodDay = Readonly<{ day: string; readings: readonly DayReading[] }>;

export type GlucoseDayRow = Readonly<{
  day: string;
  n: number;
  average_mg_dl: number;
  /** Null when no low bound is set (without diabetes). */
  below: number | null;
  above: number;
}>;

export type GlucosePeriod = Readonly<{
  /** Which glucose was read: blood, or a continuous sensor's. */
  specimen: GlucoseSpecimen;
  /** Glucose readings in the period. */
  n: number;
  /** Days with at least one glucose reading. */
  days: number;
  average_mg_dl: number | null;
  range: Readonly<{
    /** Null without diabetes: only an upper threshold is set. */
    low: number | null;
    high: number;
    unit: "mg/dL";
    thresholds: "placeholder";
  }>;
  /** Shares of readings, 0 to 1, three decimals; null with no readings. Below is null when no low bound is set. */
  share_of_readings: Readonly<{
    below: number | null;
    within: number;
    above: number;
  }> | null;
  basis: "share of readings";
  by_day: readonly GlucoseDayRow[];
}>;

const round = (value: number, places: number): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

const mean = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

const rangeOf = (
  profile: GlucoseProfile,
  thresholds: DayThresholds,
): Readonly<{ low: number | null; high: number }> =>
  profile === "with_diabetes"
    ? {
        low: thresholds.glucoseWithDiabetesRangeMgDl[0],
        high: thresholds.glucoseWithDiabetesRangeMgDl[1],
      }
    : { low: null, high: thresholds.glucoseWithoutDiabetesAboveMgDl };

/** One specimen's value in a reading, or null. */
const valueOf = (reading: DayReading, specimen: GlucoseSpecimen): number | null =>
  specimen === "sensor" ? (reading.sensorGlucoseMgDl ?? null) : reading.glucoseMgDl;

/** Average and time in range of one specimen's readings across the days given. */
export const glucosePeriod = (
  days: readonly PeriodDay[],
  profile: GlucoseProfile,
  thresholds: DayThresholds = DAY_THRESHOLDS,
  specimen: GlucoseSpecimen = "blood",
): GlucosePeriod => {
  const { low, high } = rangeOf(profile, thresholds);
  const isBelow = (value: number): boolean => low !== null && value < low;
  const isAbove = (value: number): boolean => value > high;
  const byDay = [...days]
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((one) => ({
      day: one.day,
      values: one.readings.flatMap((reading) => {
        const value = valueOf(reading, specimen);
        return value === null ? [] : [value];
      }),
    }))
    .filter((one) => one.values.length > 0);
  const values = byDay.flatMap((one) => one.values);
  const share = (count: number): number => round(count / values.length, 3);
  const below = values.filter(isBelow).length;
  const above = values.filter(isAbove).length;
  return {
    specimen,
    n: values.length,
    days: byDay.length,
    average_mg_dl: values.length === 0 ? null : round(mean(values), 1),
    range: { low, high, unit: "mg/dL", thresholds: "placeholder" },
    share_of_readings:
      values.length === 0
        ? null
        : {
            below: low === null ? null : share(below),
            within: share(values.length - below - above),
            above: share(above),
          },
    basis: "share of readings",
    by_day: byDay.map((one) => ({
      day: one.day,
      n: one.values.length,
      average_mg_dl: round(mean(one.values), 1),
      below: low === null ? null : one.values.filter(isBelow).length,
      above: one.values.filter(isAbove).length,
    })),
  };
};
