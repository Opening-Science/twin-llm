import "server-only";

import { DAY_THRESHOLDS, type GlucoseProfile } from "@/packages/query-tools/day-beats";
import { type GlucosePeriod, glucosePeriod } from "@/packages/query-tools/day-period";
import {
  ANALYTICS_ROW_CAP,
  mixedUnits,
  ROW_CAP_EXCEEDED,
  type ToolRefusal,
} from "@/packages/query-tools/refusals";
import {
  GLUCOSE_LOINCS,
  SENSOR_GLUCOSE_LOINC,
  SENSOR_LAG_NOTE,
} from "@/packages/query-tools/show-my-day";
import { glucoseDays, PERIOD_DAYS } from "@/packages/query-tools/show-my-period";
import { addDays } from "@/packages/query-tools/stats";
import {
  wearableTrend,
  type WearableTrendResult,
} from "@/packages/query-tools/wearable-analytics";
import {
  syntheticReadings,
  TREND_MEASURES,
  type TrendMeasure,
} from "@/packages/query-tools/wearable-readings";
import { comparedRead, spanOf } from "@/packages/query-tools/wearable-tools";

import { type CohortRow } from "../../biomarkers/cohort-handler";
import { periodSummary, type PeriodSummary } from "./period-summary";

/**
 * One Demo person's week or month for the summary card, from the rows the
 * Demo lab-values path reads, with the functions `show_my_period` uses:
 * `glucoseDays` and `glucosePeriod` for glucose, `wearableTrend` for resting
 * heart rate and HRV over the 35 days the trends compare. The card's lines
 * are written here, so the screen draws them and computes nothing.
 */

export type Period = keyof typeof PERIOD_DAYS;

/** The codes a period reads: glucose, resting heart rate, HRV. */
export const PERIOD_CODES: readonly string[] = [
  ...GLUCOSE_LOINCS,
  SENSOR_GLUCOSE_LOINC,
  TREND_MEASURES.resting_hr.synthetic,
  TREND_MEASURES.hrv.synthetic,
];

const GLUCOSE_UNIT = "mg/dL";

export type DemoPeriodResult =
  | Readonly<{ kind: "period"; summary: PeriodSummary; rowsUsed: number }>
  | Readonly<{ kind: "refused"; reason: "units" | "too-many" }>;

const trendOf = (
  measure: TrendMeasure,
  rows: readonly CohortRow[],
  window: Readonly<{ start: string; end: string }>,
): WearableTrendResult | ToolRefusal => {
  const code = TREND_MEASURES[measure].synthetic;
  return wearableTrend(measure, "all", window, spanOf(window), window.end, [
    { source: "synthetic", key: code, readings: syntheticReadings(rows, code) },
  ]);
};

const within = (row: CohortRow, span: Readonly<{ from: Date; to: Date }>): boolean =>
  row.effectiveAt.getTime() >= span.from.getTime() &&
  row.effectiveAt.getTime() <= span.to.getTime();

/** Sensor glucose over the period, or null without a sensor reading; never converted. */
const sensorOf = (
  rows: readonly CohortRow[],
  profile: GlucoseProfile,
): GlucosePeriod | ToolRefusal | null => {
  if (rows.length === 0) return null;
  if (rows.length > ANALYTICS_ROW_CAP) return ROW_CAP_EXCEEDED;
  const units = [...new Set(rows.map((row) => row.unitUcum))];
  if (units.some((unit) => unit !== GLUCOSE_UNIT)) {
    return mixedUnits(SENSOR_GLUCOSE_LOINC, [...new Set([GLUCOSE_UNIT, ...units])]);
  }
  return glucosePeriod(glucoseDays(rows, "sensor"), profile, DAY_THRESHOLDS, "sensor");
};

const periodWindow = (period: Period, end: string) => ({
  start: addDays(end, 1 - PERIOD_DAYS[period]),
  end,
});

/** The span a period reads: the period and the 35 days its trends compare. */
export const periodRead = (
  period: Period,
  end: string,
): Readonly<{ from: Date; to: Date }> => spanOf(comparedRead(periodWindow(period, end)));

export const demoPeriod = (
  rows: readonly CohortRow[],
  period: Period,
  end: string,
  profile: GlucoseProfile,
): DemoPeriodResult => {
  const window = periodWindow(period, end);
  // The same rows show_my_period's one capped read holds.
  const span = spanOf(window);
  const inRead = rows.filter(
    (row) => PERIOD_CODES.includes(row.loinc) && within(row, periodRead(period, end)),
  );
  // As show_my_period: sensor glucose is its own capped read over the period only.
  const read = inRead.filter((row) => row.loinc !== SENSOR_GLUCOSE_LOINC);
  const sensor = inRead.filter(
    (row) => row.loinc === SENSOR_GLUCOSE_LOINC && within(row, span),
  );
  if (read.length > ANALYTICS_ROW_CAP) return { kind: "refused", reason: "too-many" };
  const glucose = read.filter(
    (row) =>
      (GLUCOSE_LOINCS as readonly string[]).includes(row.loinc) && within(row, span),
  );
  if (glucose.some((row) => row.unitUcum !== GLUCOSE_UNIT)) {
    return { kind: "refused", reason: "units" };
  }
  return {
    kind: "period",
    rowsUsed: read.length + (sensor.length > ANALYTICS_ROW_CAP ? 0 : sensor.length),
    summary: periodSummary({
      period,
      start: window.start,
      end: window.end,
      profile,
      glucose: glucosePeriod(glucoseDays(glucose), profile),
      resting_hr: trendOf("resting_hr", read, window),
      hrv: trendOf("hrv", read, window),
      sensor_glucose: sensorOf(sensor, profile),
      sensor_lag: sensor.length > 0 ? SENSOR_LAG_NOTE : null,
    }),
  };
};
