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
    category: "Heart",
    provider: "Wearable import",
    description: "Beats per minute throughout the day.",
  },
  glucose: {
    label: YOUR_DAY_COPY.chart.glucose,
    selector: { stream: "glucose", specimen: "sensor" },
    category: "Glucose",
    provider: "Continuous glucose monitor",
    description: "Glucose readings from a continuous sensor.",
  },
  blood_glucose: {
    label: "Blood glucose",
    selector: { stream: "glucose", specimen: "blood" },
    category: "Glucose",
    provider: "Blood glucose measurements",
    description: "Individual readings of glucose in blood.",
  },
  steps: {
    label: "Steps",
    selector: { stream: "steps" },
    category: "Activity",
    provider: "Wearable import",
    description: "Step counts recorded throughout the day.",
  },
  resting_heart_rate: {
    label: "Resting heart rate",
    selector: { stream: "resting_heart_rate" },
    category: "Heart",
    provider: "Wearable import",
    description: "The resting heart rate reported for the night.",
  },
  hrv_rmssd: {
    label: "Heart rate variability",
    selector: { stream: "hrv_rmssd" },
    category: "Heart",
    provider: "Wearable import",
    description: "Nightly variation in the time between heartbeats, reported as RMSSD.",
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
