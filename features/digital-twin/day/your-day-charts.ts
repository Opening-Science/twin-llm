import { type SeriesSelector } from "@/packages/query-tools/replay/at-time";
import { STREAM_UNITS } from "@/packages/query-tools/replay/items";
import { type ReplayDay } from "@/packages/query-tools/replay/replay-day";
import {
  type ReferenceBand,
  type Unavailable,
} from "@/packages/query-tools/replay/nights";

import { YOUR_DAY_COPY } from "../twin-page-copy";

export const YOUR_DAY_CHARTS = {
  heart_rate: {
    label: YOUR_DAY_COPY.chart.heartRate,
    selector: { stream: "heart_rate" },
    ...YOUR_DAY_COPY.chartInfo.heart_rate,
  },
  glucose: {
    label: YOUR_DAY_COPY.chart.glucose,
    selector: { stream: "glucose", specimen: "sensor" },
    ...YOUR_DAY_COPY.chartInfo.glucose,
  },
  blood_glucose: {
    label: YOUR_DAY_COPY.chart.bloodGlucose,
    selector: { stream: "glucose", specimen: "blood" },
    ...YOUR_DAY_COPY.chartInfo.blood_glucose,
  },
  steps: {
    label: YOUR_DAY_COPY.chart.steps,
    selector: { stream: "steps" },
    ...YOUR_DAY_COPY.chartInfo.steps,
  },
  resting_heart_rate: {
    label: YOUR_DAY_COPY.chart.restingHeartRate,
    selector: { stream: "resting_heart_rate" },
    ...YOUR_DAY_COPY.chartInfo.resting_heart_rate,
  },
  hrv_rmssd: {
    label: YOUR_DAY_COPY.chart.hrv,
    selector: { stream: "hrv_rmssd" },
    ...YOUR_DAY_COPY.chartInfo.hrv_rmssd,
  },
} as const satisfies Record<
  string,
  {
    label: string;
    selector: SeriesSelector;
    category: string;
    provider: string;
    description: string;
  }
>;

export type YourDayChartId = keyof typeof YOUR_DAY_CHARTS;
export const MAX_YOUR_DAY_CHARTS = 6;

export function toggleYourDayChart(draft: readonly YourDayChartId[], id: YourDayChartId) {
  if (draft.includes(id)) return draft.filter((chartId) => chartId !== id);
  return draft.length < MAX_YOUR_DAY_CHARTS ? [...draft, id] : draft;
}

/** Interpolate within a plotted run only, never across a gap. */
export function plottedValueAt(
  segments: readonly (readonly Readonly<{ ms: number; value: number }>[])[],
  ms: number,
): number | null {
  for (const segment of segments) {
    const first = segment[0];
    const last = segment.at(-1);
    if (!first || !last || ms < first.ms || ms > last.ms) continue;

    const index = segment.findIndex((point) => point.ms >= ms);
    const next = segment[index]!;
    if (next.ms === ms) return next.value;
    const previous = segment[index - 1]!;
    return (
      previous.value +
      (next.value - previous.value) * ((ms - previous.ms) / (next.ms - previous.ms))
    );
  }
  return null;
}
export const DEFAULT_CHART_IDS: readonly YourDayChartId[] = [
  "heart_rate",
  "glucose",
  "blood_glucose",
  "steps",
  "resting_heart_rate",
  "hrv_rmssd",
];
export const chartUnit = (id: YourDayChartId) => {
  const unit = STREAM_UNITS[YOUR_DAY_CHARTS[id].selector.stream];
  return unit === "/min" ? "bpm" : unit;
};

export type YourDayChartData = Readonly<{
  day: ReplayDay;
  bands: Readonly<
    Record<"resting_heart_rate" | "hrv_rmssd", ReferenceBand | Unavailable>
  >;
}>;
