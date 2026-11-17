import "server-only";

import { ANALYTICS_ROW_CAP } from "@/packages/query-tools/refusals";
import {
  DAY_THRESHOLDS,
  type DayReading,
  dayBeats,
  type GlucoseProfile,
  redWindows,
} from "@/packages/query-tools/day-beats";
import MOCK_DAY from "@/packages/query-tools/fixtures/mock-day.json";
import { type KioskDay, toKioskDay } from "@/packages/query-tools/kiosk-day";
import {
  GLUCOSE_LOINCS,
  HEART_RATE_LOINC,
  readingsFromRows,
} from "@/packages/query-tools/show-my-day";
import { utcDay } from "@/packages/query-tools/stats";

import { type CohortRow } from "../biomarkers/cohort-handler";
import { type DayListEntry } from "./day-view";

/**
 * One Demo person's day for "Show me my day", built from the rows the Demo
 * lab-values path reads (`cohort-ports.ts`), with the functions `show_my_day`
 * uses: `readingsFromRows`, `dayBeats`, `redWindows`, then `toKioskDay` for a
 * display-ready shape. The screen draws what comes back and computes nothing.
 *
 * The illustrative mock day is its own result from the fixture, labelled as
 * mock, and never mixed with a person's readings.
 */

/** The codes a day reads: heart rate and blood glucose, as `show_my_day` reads them. */
export const DAY_CODES: readonly string[] = [HEART_RATE_LOINC, ...GLUCOSE_LOINCS];

const UNIT_OF = (loinc: string): string =>
  loinc === HEART_RATE_LOINC ? "/min" : "mg/dL";

/** The subject_ref the mock day carries; never a warehouse subject. */
export const MOCK_DAY_REF = "synthetic-mock-day";

export type DemoDayResult =
  | Readonly<{ kind: "day"; day: KioskDay }>
  | Readonly<{ kind: "refused"; reason: "units" | "too-many" | "no-readings" }>;

/** UTC days with a heart rate or glucose reading, newest first, with their row counts. */
export const dayList = (rows: readonly CohortRow[]): readonly DayListEntry[] => {
  const counts = rows
    .filter((row) => DAY_CODES.includes(row.loinc))
    .reduce<Map<string, number>>((acc, row) => {
      const day = utcDay(row.effectiveAt);
      acc.set(day, (acc.get(day) ?? 0) + 1);
      return acc;
    }, new Map());
  return [...counts.entries()]
    .map(([day, readings]) => ({ day, readings }))
    .sort((a, b) => b.day.localeCompare(a.day));
};

/**
 * The person's UTC day as a kiosk day. Like `show_my_day`, a day over the
 * row cap or with a unit other than /min or mg/dL is refused, never cut or
 * converted.
 */
export const demoDay = (
  rows: readonly CohortRow[],
  subjectRef: string,
  day: string,
  profile: GlucoseProfile,
): DemoDayResult => {
  const ofDay = rows
    .filter((row) => DAY_CODES.includes(row.loinc) && utcDay(row.effectiveAt) === day)
    .sort((a, b) => a.effectiveAt.getTime() - b.effectiveAt.getTime());
  if (ofDay.length === 0) return { kind: "refused", reason: "no-readings" };
  if (ofDay.length > ANALYTICS_ROW_CAP) return { kind: "refused", reason: "too-many" };
  if (ofDay.some((row) => row.unitUcum !== UNIT_OF(row.loinc))) {
    return { kind: "refused", reason: "units" };
  }
  const readings = readingsFromRows(ofDay);
  return {
    kind: "day",
    day: toKioskDay({
      subject_ref: subjectRef,
      day,
      profile,
      beats: dayBeats(readings, profile),
      red_windows: redWindows(readings, profile),
      thresholds: { status: DAY_THRESHOLDS.status, reviewer: DAY_THRESHOLDS.reviewer },
      activity: "not recorded",
      timezone: "UTC",
    }),
  };
};

const MOCK_READINGS: readonly DayReading[] = MOCK_DAY.readings.map((one) => ({
  time: one.time,
  event: one.event,
  heartRatePerMin: one.heart_rate_per_min,
  glucoseMgDl: one.glucose_mg_dl,
  moving: one.moving,
}));

/** The illustrative mock day (`fixtures/mock-day.json`): made-up values, activity recorded. */
export const mockDay = (profile: GlucoseProfile): KioskDay =>
  toKioskDay({
    subject_ref: MOCK_DAY_REF,
    day: MOCK_DAY.day,
    profile,
    beats: dayBeats(MOCK_READINGS, profile),
    red_windows: redWindows(MOCK_READINGS, profile),
    thresholds: { status: DAY_THRESHOLDS.status, reviewer: DAY_THRESHOLDS.reviewer },
    activity: "recorded",
    timezone: "UTC",
  });
