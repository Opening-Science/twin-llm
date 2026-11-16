import "server-only";

import type { z } from "zod";

import { DAY_THRESHOLDS, type DayReading, type GlucoseProfile } from "./day-beats";
import { glucosePeriod, type GlucosePeriod, type PeriodDay } from "./day-period";
import {
  defaultQueryToolPorts,
  type ObservationRecord,
  type QueryToolPorts,
} from "./ports";
import { isToolRefusal, mixedUnits, type ToolRefusal } from "./refusals";
import { type showMyPeriodInput } from "./schemas";
import { SUBJECT_SCOPE_VIOLATION, type SessionScope } from "./scope";
import { GLUCOSE_LOINCS } from "./show-my-day";
import { addDays, utcDay } from "./stats";
import { audited, distinctUnits, readWindow, subjectInScope } from "./tool-core";
import { wearableTrend, type WearableTrendResult } from "./wearable-analytics";
import {
  syntheticReadings,
  TREND_MEASURES,
  type TrendMeasure,
} from "./wearable-readings";
import { comparedRead, spanOf } from "./wearable-tools";

/**
 * `show_my_period`: one synthetic subject's week or month. Glucose as average
 * and time in range (`day-period.ts`, the placeholder thresholds of
 * `show_my_day`), and the resting heart rate and HRV trends with the maths
 * `resting_hr_trend` and `hrv_trend` use (`wearableTrend`). Scope first, one
 * capped read over the period and the 35 days the trends compare, audited.
 * Recovery after workouts needs workout times; the warehouse stores minutes
 * per day only, so it is "not recorded".
 */

/** Days a period covers, ending on `end`. */
export const PERIOD_DAYS = { week: 7, month: 30 } as const;

const GLUCOSE_UNIT = "mg/dL";

type ShowMyPeriodInput = z.infer<typeof showMyPeriodInput>;

export type ShowMyPeriodResult = Readonly<{
  subject_ref: string;
  period: keyof typeof PERIOD_DAYS;
  /** First and last UTC day of the period. */
  start: string;
  end: string;
  profile: GlucoseProfile;
  /** Rows read: the period, and the 35 days before its end the trends compare. */
  n: number;
  glucose: GlucosePeriod;
  /** As `resting_hr_trend` and `hrv_trend` return them, refusal included. */
  resting_hr: WearableTrendResult | ToolRefusal;
  hrv: WearableTrendResult | ToolRefusal;
  recovery: "not recorded";
  thresholds: Readonly<{ status: "placeholder"; reviewer: string }>;
  timezone: "UTC";
}>;

const isGlucose = (loinc: string): boolean =>
  (GLUCOSE_LOINCS as readonly string[]).includes(loinc);

/** Glucose rows to days of readings, one reading per row, by UTC day. */
export const glucoseDays = (rows: readonly ObservationRecord[]): readonly PeriodDay[] => {
  const byDay = rows.reduce<Map<string, DayReading[]>>((acc, row) => {
    const day = utcDay(row.effectiveAt);
    const reading: DayReading = {
      time: row.effectiveAt.toISOString().slice(11, 16),
      event: null,
      heartRatePerMin: null,
      glucoseMgDl: row.value,
      moving: null,
    };
    acc.set(day, [...(acc.get(day) ?? []), reading]);
    return acc;
  }, new Map());
  return [...byDay.entries()].map(([day, readings]) => ({ day, readings }));
};

const trendOf = (
  measure: TrendMeasure,
  rows: readonly ObservationRecord[],
  window: Readonly<{ start: string; end: string }>,
): WearableTrendResult | ToolRefusal => {
  const code = TREND_MEASURES[measure].synthetic;
  return wearableTrend(measure, "all", window, spanOf(window), window.end, [
    { source: "synthetic", key: code, readings: syntheticReadings(rows, code) },
  ]);
};

export const runShowMyPeriod = (
  scope: SessionScope,
  input: ShowMyPeriodInput,
  ports: QueryToolPorts = defaultQueryToolPorts(),
): Promise<ShowMyPeriodResult | ToolRefusal> =>
  audited<ShowMyPeriodResult | ToolRefusal>(
    scope,
    "show_my_period",
    input,
    input.subject_ref,
    async () => {
      if (!(await subjectInScope(scope, input.subject_ref, ports))) {
        return SUBJECT_SCOPE_VIOLATION;
      }
      const window = {
        start: addDays(input.end, 1 - PERIOD_DAYS[input.period]),
        end: input.end,
      };
      const rows = await readWindow(
        ports,
        input.subject_ref,
        [
          ...GLUCOSE_LOINCS,
          TREND_MEASURES.resting_hr.synthetic,
          TREND_MEASURES.hrv.synthetic,
        ],
        comparedRead(window),
      );
      if (isToolRefusal(rows)) return rows;
      const span = spanOf(window);
      const glucose = rows.filter(
        (row) =>
          isGlucose(row.loinc) &&
          row.effectiveAt.getTime() >= span.from.getTime() &&
          row.effectiveAt.getTime() <= span.to.getTime(),
      );
      const units = distinctUnits(glucose);
      if (units.some((unit) => unit !== GLUCOSE_UNIT)) {
        return mixedUnits(glucose[0]?.loinc ?? GLUCOSE_LOINCS[0], [
          ...new Set([GLUCOSE_UNIT, ...units]),
        ]);
      }
      return {
        subject_ref: input.subject_ref,
        period: input.period,
        start: window.start,
        end: window.end,
        profile: input.profile,
        n: rows.length,
        glucose: glucosePeriod(glucoseDays(glucose), input.profile),
        resting_hr: trendOf("resting_hr", rows, window),
        hrv: trendOf("hrv", rows, window),
        recovery: "not recorded",
        thresholds: { status: DAY_THRESHOLDS.status, reviewer: DAY_THRESHOLDS.reviewer },
        timezone: "UTC",
      };
    },
    (result) => ("n" in result ? result.n : 0),
    ports,
  );
