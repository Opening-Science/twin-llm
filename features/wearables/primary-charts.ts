import { measureKindFor } from "@/infrastructure/format-measure";

import type { WearableSource } from "./dashboard-headings";
import { CHART_COLORS, type ChartSeries } from "./interactive-chart";
import { pointsByPrefix, type Metric } from "./metric-utils";

type PrimarySeries = Readonly<{
  label: string;
  prefix: string;
  /** Series with the same chart number share one y-axis, so they must share a scale. */
  chart: number;
}>;

/**
 * The timeline under the rings. Oura and Whoop plot two 0–100 scores, which
 * read fine on one axis. Google Health plots steps (thousands) and resting
 * heart rate (tens): on one axis the heart rate was a flat line along the
 * bottom, so each gets its own chart and its own honest axis.
 */
export const PRIMARY_SERIES: Readonly<Record<WearableSource, readonly PrimarySeries[]>> =
  {
    oura: [
      { label: "Sleep score", prefix: "sleep.score.", chart: 0 },
      { label: "Readiness", prefix: "readiness.score.", chart: 0 },
    ],
    whoop: [
      { label: "Sleep performance", prefix: "whoop.sleep.performance.", chart: 0 },
      { label: "Recovery", prefix: "whoop.recovery.score.", chart: 0 },
    ],
    "google-health": [
      { label: "Steps", prefix: "google.steps.", chart: 0 },
      { label: "Resting HR", prefix: "google.daily-resting-heart-rate.", chart: 1 },
    ],
  };

/** One series list per chart with data, in chart order; an empty window gives none. */
export const primaryCharts = (
  source: WearableSource,
  metrics: readonly Metric[],
): readonly (readonly ChartSeries[])[] => {
  if (metrics.length === 0) return [];
  const specs = PRIMARY_SERIES[source];
  const charts = [...new Set(specs.map((spec) => spec.chart))].sort((a, b) => a - b);
  // Colours follow the series' place in the list, not in its chart, so resting
  // HR keeps the colour it had when it shared the chart with steps.
  // A chart none of whose series has a point in the window is left out, so
  // steps-only data shows one chart rather than an empty "not enough" box.
  return charts
    .map((chart) =>
      specs.flatMap((spec, index) =>
        spec.chart === chart
          ? [
              {
                id: spec.prefix,
                label: spec.label,
                points: pointsByPrefix(metrics, spec.prefix),
                kind: measureKindFor(spec.prefix) ?? undefined,
                className: CHART_COLORS[index % CHART_COLORS.length],
              },
            ]
          : [],
      ),
    )
    .filter((chart) => chart.some((series) => series.points.length > 0));
};
