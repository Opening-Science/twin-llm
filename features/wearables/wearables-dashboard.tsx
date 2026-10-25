"use client";

import { useMemo } from "react";

import type { OuraSummary } from "@/infrastructure/oura-types";
import type { WhoopSummary } from "@/infrastructure/whoop-types";
import {
  formatDate,
  formatMeasureCompact,
  measureKindFor,
  type MeasureKind,
} from "@/infrastructure/format-measure";
import { Button } from "@/infrastructure/ui-kit/button";

import {
  heroEyebrow,
  heroHeadline,
  sectionHeading,
  sectionScorePrefix,
  type WearableSource,
} from "./dashboard-headings";
import { type DateRangeValue } from "./date-range-bar";
import { InteractiveChart } from "./interactive-chart";
import { primaryCharts } from "./primary-charts";
import {
  COMPARE_ROWS,
  filterMetricsByRange,
  formatValue,
  groupMetrics,
  latestByPrefix,
  numericValue,
  pointsByPrefix,
  displayLabel,
  type Metric,
  type Summary,
} from "./metric-utils";

/**
 * The wearables dashboard under the connector cards: one source at a time, or
 * Oura and Whoop side by side. It owns no connection state; the screen passes
 * the summaries, the window and the sync action down.
 */

const OURA_GROUPS = [
  { title: "Sleep", match: (key: string) => key.startsWith("sleep.") },
  { title: "Readiness", match: (key: string) => key.startsWith("readiness.") },
  { title: "Activity", match: (key: string) => key.startsWith("activity.") },
  { title: "Personal", match: (key: string) => key.startsWith("personal.") },
] as const;

const WHOOP_GROUPS = [
  { title: "Recovery", match: (key: string) => key.startsWith("whoop.recovery.") },
  { title: "Strain", match: (key: string) => key.startsWith("whoop.cycle.") },
  { title: "Sleep", match: (key: string) => key.startsWith("whoop.sleep.") },
] as const;

const GOOGLE_HEALTH_GROUPS = [
  {
    title: "Activity",
    match: (key: string) => /google\.(steps|distance|active-)/.test(key),
  },
  {
    title: "Heart & recovery",
    match: (key: string) =>
      /google\.(daily-resting-heart-rate|daily-heart-rate-variability|heart-rate)/.test(
        key,
      ),
  },
  {
    title: "Sleep & SpO2",
    match: (key: string) => /google\.(sleep|oxygen-saturation|daily-oxygen)/.test(key),
  },
  { title: "Body", match: (key: string) => /google\.(weight|body-fat|height)/.test(key) },
] as const;

const GROUPS = {
  oura: OURA_GROUPS,
  whoop: WHOOP_GROUPS,
  "google-health": GOOGLE_HEALTH_GROUPS,
} as const;

type RingSpec = Readonly<{
  label: string;
  value: number | null;
  max: number;
  progress: boolean;
  kind?: MeasureKind;
}>;

const ScoreRing = ({
  label,
  value,
  max = 100,
  progress = true,
  kind = "score",
}: {
  readonly label: string;
  readonly value: number | null;
  readonly max?: number;
  readonly progress?: boolean;
  readonly kind?: MeasureKind;
}) => {
  const size = 72;
  const stroke = 3.5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = !progress || value === null ? 0 : Math.min(1, Math.max(0, value / max));
  const offset = c * (1 - pct);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90" aria-hidden>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke}
            className="text-border"
          />
          {progress && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke="currentColor"
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={offset}
              className="text-foreground transition-[stroke-dashoffset] duration-500"
            />
          )}
        </svg>
        <span className="absolute inset-0 flex items-center justify-center font-mono text-lg font-bold tabular-nums">
          {formatMeasureCompact(kind, value)}
        </span>
      </div>
      <span className="text-muted-foreground text-xs font-medium tracking-wide">
        {label}
      </span>
    </div>
  );
};

const MetricTable = ({ metrics }: { readonly metrics: readonly Metric[] }) => {
  const rows = useMemo(() => {
    const byDate = [...metrics].sort((a, b) =>
      (b.date ?? "").localeCompare(a.date ?? ""),
    );
    // Oura can emit the same key twice for one calendar day (e.g. long sleep +
    // nap). Keep the first after sort so React keys stay unique.
    const seen = new Set<string>();
    const unique: Metric[] = [];
    for (const metric of byDate) {
      if (seen.has(metric.key)) continue;
      seen.add(metric.key);
      unique.push(metric);
    }
    return unique.slice(0, 24);
  }, [metrics]);

  return (
    <div className="mt-4 overflow-hidden">
      <table className="w-full text-left">
        <caption className="sr-only">Metric detail</caption>
        <tbody>
          {rows.map((metric, index) => (
            <tr
              key={`${metric.key}:${index}`}
              className="border-border border-t first:border-t-0"
            >
              <th scope="row" className="text-foreground py-2.5 pr-3 text-sm font-medium">
                {displayLabel(metric)}
              </th>
              <td className="text-muted-foreground py-2.5 font-mono text-xs">
                {formatDate(metric.date)}
              </td>
              <td className="text-foreground py-2.5 text-right font-mono text-sm">
                {formatValue(metric)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const ComparePanel = ({
  oura,
  whoop,
  range,
}: {
  readonly oura: OuraSummary;
  readonly whoop: WhoopSummary;
  readonly range: DateRangeValue;
}) => {
  const ouraMetrics = filterMetricsByRange(oura.metrics, range.startDate, range.endDate);
  const whoopMetrics = filterMetricsByRange(
    whoop.metrics,
    range.startDate,
    range.endDate,
  );

  const chartSeries = useMemo(
    () => [
      {
        id: "oura-sleep",
        label: "Oura sleep",
        points: pointsByPrefix(ouraMetrics, "sleep.score."),
      },
      {
        id: "whoop-sleep",
        label: "Whoop sleep",
        points: pointsByPrefix(whoopMetrics, "whoop.sleep.performance."),
      },
    ],
    [ouraMetrics, whoopMetrics],
  );

  return (
    <div className="mt-6 flex flex-col gap-4">
      <section className="surface px-5 py-5">
        <p className="text-eyebrow">Compare</p>
        <h2 className="font-display mt-2 text-2xl tracking-tight">
          Oura and Whoop side by side
        </h2>
        <p className="text-muted-foreground mt-2 max-w-prose text-sm leading-relaxed">
          Aligned scores for the selected timeline. Interpretation across devices stays a
          later layer — this is the raw compare surface.
        </p>
        <div className="mt-5">
          <InteractiveChart series={chartSeries} />
        </div>
      </section>

      <div className="surface overflow-hidden">
        <table className="w-full text-left">
          <caption className="sr-only">Oura vs Whoop latest metrics</caption>
          <thead>
            <tr className="border-border border-b">
              <th scope="col" className="text-eyebrow px-4 py-2.5 font-medium">
                Metric
              </th>
              <th scope="col" className="text-eyebrow px-4 py-2.5 font-medium">
                Oura
              </th>
              <th scope="col" className="text-eyebrow px-4 py-2.5 font-medium">
                Whoop
              </th>
            </tr>
          </thead>
          <tbody>
            {COMPARE_ROWS.map((row) => {
              const o = latestByPrefix(ouraMetrics, row.oura);
              const w = latestByPrefix(whoopMetrics, row.whoop);
              return (
                <tr key={row.id} className="border-border border-b last:border-b-0">
                  <th
                    scope="row"
                    className="text-foreground px-4 py-3 text-sm font-medium"
                  >
                    {row.label}
                  </th>
                  <td className="px-4 py-3 font-mono text-sm">
                    {o ? (
                      <>
                        {formatValue(o)}
                        {o.date && (
                          <span className="text-muted-foreground ml-2 text-xs">
                            {formatDate(o.date)}
                          </span>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-sm">
                    {w ? (
                      <>
                        {formatValue(w)}
                        {w.date && (
                          <span className="text-muted-foreground ml-2 text-xs">
                            {formatDate(w.date)}
                          </span>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const ringsFor = (source: WearableSource, metrics: readonly Metric[]): RingSpec[] => {
  if (source === "oura") {
    return [
      {
        label: "Readiness",
        value: numericValue(latestByPrefix(metrics, "readiness.score.")),
        max: 100,
        progress: true,
      },
      {
        label: "Sleep",
        value: numericValue(latestByPrefix(metrics, "sleep.score.")),
        max: 100,
        progress: true,
      },
      {
        label: "Activity",
        value: numericValue(latestByPrefix(metrics, "activity.score.")),
        max: 100,
        progress: true,
      },
      {
        label: "Heart rate",
        value: numericValue(latestByPrefix(metrics, "sleep.hr.")),
        kind: "heartRate",
        max: 100,
        progress: false,
      },
    ];
  }
  if (source === "whoop") {
    return [
      {
        label: "Recovery",
        value: numericValue(latestByPrefix(metrics, "whoop.recovery.score.")),
        max: 100,
        progress: true,
      },
      {
        label: "Strain",
        value: numericValue(latestByPrefix(metrics, "whoop.cycle.strain.")),
        kind: "strain",
        max: 21,
        progress: true,
      },
      {
        label: "Sleep",
        value: numericValue(latestByPrefix(metrics, "whoop.sleep.performance.")),
        max: 100,
        progress: true,
      },
      {
        label: "Resting HR",
        value: numericValue(latestByPrefix(metrics, "whoop.recovery.rhr.")),
        kind: "heartRate",
        max: 100,
        progress: false,
      },
    ];
  }
  return [
    {
      label: "Steps",
      value: numericValue(latestByPrefix(metrics, "google.steps.")),
      kind: "steps",
      max: 12_000,
      progress: true,
    },
    {
      label: "Resting HR",
      value: numericValue(latestByPrefix(metrics, "google.daily-resting-heart-rate.")),
      kind: "heartRate",
      max: 100,
      progress: false,
    },
    {
      label: "HRV",
      kind: "hrv",
      value: numericValue(
        latestByPrefix(metrics, "google.daily-heart-rate-variability."),
      ),
      max: 120,
      progress: false,
    },
    {
      label: "Active min",
      value: numericValue(latestByPrefix(metrics, "google.active-minutes.")),
      max: 60,
      progress: true,
    },
  ];
};

type WearablesDashboardProps = {
  readonly view: "single" | "compare";
  readonly source: WearableSource;
  readonly range: DateRangeValue;
  readonly activeConnected: boolean;
  readonly activeSummary: Summary | null;
  readonly ouraSummary: OuraSummary | null;
  readonly whoopSummary: WhoopSummary | null;
  readonly busy: boolean;
  readonly onSync: () => void;
};

export const WearablesDashboard = ({
  view,
  source,
  range,
  activeConnected,
  activeSummary,
  ouraSummary,
  whoopSummary,
  busy,
  onSync,
}: WearablesDashboardProps) => {
  const metrics = useMemo(() => {
    if (!activeSummary) return [];
    return filterMetricsByRange(activeSummary.metrics, range.startDate, range.endDate);
  }, [activeSummary, range]);

  const sections = useMemo(
    () => (metrics.length === 0 ? [] : groupMetrics(metrics, GROUPS[source])),
    [metrics, source],
  );

  const rings = useMemo(
    () => (activeSummary ? ringsFor(source, metrics) : []),
    [activeSummary, metrics, source],
  );

  const timelineCharts = useMemo(() => primaryCharts(source, metrics), [metrics, source]);

  if (view === "compare" && ouraSummary && whoopSummary) {
    return <ComparePanel oura={ouraSummary} whoop={whoopSummary} range={range} />;
  }

  if (!activeConnected) {
    return (
      <p className="text-muted-foreground max-w-xl text-[15px] leading-relaxed">
        Link a connector above to open its dashboard here.
      </p>
    );
  }

  if (!activeSummary) {
    return (
      <div>
        <p className="text-muted-foreground max-w-xl text-[15px] leading-relaxed">
          Linked, but no snapshot yet. Sync the timeline window to pull metrics.
        </p>
        <Button className="mt-4" disabled={busy} onClick={onSync}>
          Sync metrics
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="wearables-hero relative overflow-hidden rounded-2xl px-5 py-8 sm:px-8">
        <p className="text-eyebrow">
          {heroEyebrow(source, range.startDate, range.endDate)}
        </p>

        {rings.length > 0 && (
          <div className="mt-6 flex flex-wrap justify-between gap-6 sm:justify-start sm:gap-10">
            {rings.map((ring) => (
              <ScoreRing
                key={ring.label}
                label={ring.label}
                value={ring.value}
                kind={ring.kind}
                max={ring.max}
                progress={ring.progress}
              />
            ))}
          </div>
        )}

        <h2 className="font-display mt-8 max-w-xl text-3xl leading-[1.15] tracking-tight sm:text-4xl">
          {heroHeadline(source, metrics)}
        </h2>
        <p className="metric metric-value mt-4">
          {`${metrics.length} metrics in view · ${activeSummary.metrics.length} in latest sync`}
        </p>
      </div>

      <section className="surface mt-6 px-5 py-5">
        <p className="text-eyebrow">Timeline chart</p>
        <h3 className="font-display mt-2 text-xl tracking-tight">
          Hover for daily values
        </h3>
        <div className="mt-4 flex flex-col gap-6">
          {timelineCharts.map((chart) => (
            <InteractiveChart
              key={chart.map((series) => series.id).join("+")}
              series={chart}
            />
          ))}
        </div>
      </section>

      <div className="mt-6 flex flex-col gap-4">
        {sections.map((section) => {
          const scorePrefix = sectionScorePrefix(source, section.title);
          const chartPoints = scorePrefix
            ? pointsByPrefix(section.metrics, scorePrefix)
            : [];

          return (
            <section key={section.title} className="surface px-5 py-5">
              <p className="text-eyebrow">{section.title}</p>
              <h3 className="font-display mt-2 text-2xl leading-tight tracking-tight">
                {sectionHeading(source, section.title, section.metrics)}
              </h3>
              {chartPoints.length > 1 && (
                <div className="mt-4">
                  <InteractiveChart
                    height={140}
                    series={[
                      {
                        id: section.title,
                        label: section.title,
                        points: chartPoints,
                        kind: measureKindFor(scorePrefix ?? "") ?? undefined,
                      },
                    ]}
                  />
                </div>
              )}
              <MetricTable metrics={section.metrics} />
            </section>
          );
        })}
      </div>
    </>
  );
};
