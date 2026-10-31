import type { BentoSpan } from "@/infrastructure/ui-kit/bento-model";

import type { WearableSource } from "./dashboard-headings";
import { pointsByPrefix, type Metric } from "./metric-utils";

/**
 * Which cards the wearables dashboard shows, and how wide, from the metrics
 * in view. Pure, so the choice is tested per source. A card with no data
 * is left out rather than drawn empty, and the cards that share a row
 * divide the four columns between them so every row ends flush.
 */

export type TrendSpec = Readonly<{ label: string; prefix: string }>;

export type DashboardTrends = Readonly<{
  heart: TrendSpec | null;
  sleep: TrendSpec | null;
  hrv: TrendSpec | null;
  steps: TrendSpec | null;
}>;

/**
 * The stored series each card follows. Oura's heart rate is the average
 * during sleep; Whoop and Google Health report a resting heart rate. All
 * three HRV series are RMSSD. Whoop has no steps and Google Health's sleep
 * has no fixed unit, so those cards do not exist for them.
 */
export const DASHBOARD_TRENDS: Readonly<Record<WearableSource, DashboardTrends>> = {
  oura: {
    heart: { label: "Heart rate during sleep", prefix: "sleep.hr." },
    sleep: { label: "Sleep duration", prefix: "sleep.duration." },
    hrv: { label: "HRV (RMSSD)", prefix: "sleep.hrv." },
    steps: { label: "Steps", prefix: "activity.steps." },
  },
  whoop: {
    heart: { label: "Resting HR", prefix: "whoop.recovery.rhr." },
    sleep: { label: "Time in bed", prefix: "whoop.sleep.in_bed_min." },
    hrv: { label: "HRV (RMSSD)", prefix: "whoop.recovery.hrv." },
    steps: null,
  },
  "google-health": {
    heart: { label: "Resting HR", prefix: "google.daily-resting-heart-rate." },
    sleep: null,
    hrv: { label: "HRV (RMSSD)", prefix: "google.daily-heart-rate-variability." },
    steps: { label: "Steps", prefix: "google.steps." },
  },
};

export type DashboardCardId =
  "summary" | "heart" | "timeline" | "sleep" | "hrv" | "steps" | "sources" | "privacy";

export type DashboardCard = Readonly<{ id: DashboardCardId; span: BentoSpan }>;

/** Four columns shared by the cards of one row, the first taking any extra. */
const ROW_SPANS: Readonly<Record<number, readonly number[]>> = {
  1: [4],
  2: [2, 2],
  3: [2, 1, 1],
};

const row = (ids: readonly DashboardCardId[], rows: number): DashboardCard[] => {
  const spans = ROW_SPANS[ids.length] ?? [];
  return ids.map((id, index) => ({ id, span: { cols: spans[index] ?? 1, rows } }));
};

/** Days with a value for a series; a missing series has none. */
const days = (metrics: readonly Metric[], spec: TrendSpec | null): number =>
  spec ? pointsByPrefix(metrics, spec.prefix).length : 0;

export type DashboardCardsInput = Readonly<{
  source: WearableSource;
  metrics: readonly Metric[];
  /** Charts the score timeline would draw (`primaryCharts(...).length`). */
  timelineCharts: number;
  /** Linked sources listed on the data sources card. */
  linkedSources: number;
}>;

export const dashboardCards = ({
  source,
  metrics,
  timelineCharts,
  linkedSources,
}: DashboardCardsInput): readonly DashboardCard[] => {
  const trends = DASHBOARD_TRENDS[source];
  // A trend line needs two days; a single figure needs one.
  const charts: DashboardCardId[] = [
    ...(days(metrics, trends.heart) >= 2 ? (["heart"] as const) : []),
    ...(timelineCharts > 0 ? (["timeline"] as const) : []),
  ];
  const figures: DashboardCardId[] = (["sleep", "hrv", "steps"] as const).filter(
    (id) => days(metrics, trends[id]) >= 1,
  );
  const footer: DashboardCardId[] =
    linkedSources > 0 ? ["sources", "privacy"] : ["privacy"];
  return [
    { id: "summary", span: { cols: 4, rows: 1 } },
    ...row(charts, charts.length === 2 ? 2 : 1),
    ...row(figures, 1),
    ...row(footer, 1),
  ];
};
