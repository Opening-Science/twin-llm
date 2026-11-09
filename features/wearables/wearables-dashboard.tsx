"use client";

import { useMemo } from "react";

import type { OuraSummary } from "@/infrastructure/oura-types";
import type { WhoopSummary } from "@/infrastructure/whoop-types";
import {
  formatDate,
  isoLocalDate,
  measureKindFor,
} from "@/infrastructure/format-measure";
import { BentoCard, BentoGrid } from "@/infrastructure/ui-kit/bento-grid";
import { Button } from "@/infrastructure/ui-kit/button";

import {
  SOURCE_LABEL,
  heroEyebrow,
  sectionHeading,
  sectionScorePrefix,
  type WearableSource,
} from "./dashboard-headings";
import { type DateRangeValue } from "./date-range-bar";
import { InteractiveChart } from "./interactive-chart";
import { kitSections } from "./kit-cards";
import { KitDashboard } from "./kit-dashboard";
import { useWearableDetail } from "./use-wearable-detail";
import {
  COMPARE_ROWS,
  filterMetricsByRange,
  formatValue,
  groupMetrics,
  latestByPrefix,
  pointsByPrefix,
  displayLabel,
  type Metric,
  type Summary,
} from "./metric-utils";

/**
 * The wearables dashboard under the connector cards: one source at a time, or
 * Oura and Whoop side by side. One source reads as Daily, Weekly and Monthly
 * sections of chart-kit cards (`kit-cards.ts`), then every metric in view by
 * group. The cards that need more than a value a day (steps by the hour,
 * sleep stages, bedtimes) read the detail route (`use-wearable-detail.ts`). It owns no connection state; the screen passes the summaries, the
 * window and the sync action down.
 */

const OURA_GROUPS = [
  { title: "Sleep", match: (key: string) => key.startsWith("sleep.") },
  { title: "Readiness", match: (key: string) => key.startsWith("readiness.") },
  { title: "Activity", match: (key: string) => key.startsWith("activity.") },
  { title: "Workouts", match: (key: string) => key.startsWith("workout.") },
  { title: "SpO2", match: (key: string) => key.startsWith("spo2.") },
  { title: "Stress", match: (key: string) => key.startsWith("stress.") },
  { title: "VO2 max", match: (key: string) => key.startsWith("vo2max.") },
  { title: "Personal", match: (key: string) => key.startsWith("personal.") },
] as const;

const WHOOP_GROUPS = [
  { title: "Recovery", match: (key: string) => key.startsWith("whoop.recovery.") },
  { title: "Strain", match: (key: string) => key.startsWith("whoop.cycle.") },
  { title: "Sleep", match: (key: string) => key.startsWith("whoop.sleep.") },
  { title: "Workouts", match: (key: string) => key.startsWith("whoop.workout.") },
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

export type DashboardSource = Readonly<{
  id: WearableSource;
  name: string;
  /** "Synced 3 h ago", from the connector status. */
  detail: string;
}>;

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
  /** Linked sources for the data sources card. */
  readonly linkedSources: readonly DashboardSource[];
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
  linkedSources,
}: WearablesDashboardProps) => {
  const metrics = useMemo(() => {
    if (!activeSummary) return [];
    return filterMetricsByRange(activeSummary.metrics, range.startDate, range.endDate);
  }, [activeSummary, range]);

  const sections = useMemo(
    () => (metrics.length === 0 ? [] : groupMetrics(metrics, GROUPS[source])),
    [metrics, source],
  );

  const detail = useWearableDetail(
    source,
    range,
    activeConnected && view === "single" ? activeSummary : null,
  );

  const kit = useMemo(() => {
    const now = new Date();
    return kitSections({
      source,
      metrics,
      today: isoLocalDate(now),
      detail,
      nowMinutes: now.getHours() * 60 + now.getMinutes(),
    });
  }, [metrics, source, detail]);

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
      <p className="text-eyebrow">
        {heroEyebrow(source, range.startDate, range.endDate)}
      </p>
      <p className="metric metric-value mt-2">
        {`${metrics.length} metrics in view · ${activeSummary.metrics.length} in latest sync`}
      </p>

      <div className="mt-8">
        <KitDashboard sections={kit} source={source} />
      </div>

      <BentoGrid label={`${SOURCE_LABEL[source]} sources and privacy`} className="mt-10">
        {linkedSources.length > 0 && (
          <BentoCard span={{ cols: 2, rows: 1 }}>
            <p className="text-eyebrow">Data sources</p>
            <ul className="mt-3 flex flex-col">
              {linkedSources.map((linked) => (
                <li
                  key={linked.id}
                  className="border-border flex items-baseline justify-between gap-3 border-t py-2.5 first:border-t-0"
                >
                  <span className="text-sm font-medium">
                    {linked.name}
                    {linked.id === source && (
                      <span className="text-muted-foreground ml-2 text-xs font-normal">
                        Viewing
                      </span>
                    )}
                  </span>
                  <span className="text-muted-foreground font-mono text-xs">
                    {linked.detail}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground mt-auto pt-3 text-xs">
              {`Snapshot window ${formatDate(activeSummary.window.startDate)} → ${formatDate(activeSummary.window.endDate)}`}
            </p>
          </BentoCard>
        )}
        <BentoCard
          span={{ cols: linkedSources.length > 0 ? 2 : 4, rows: 1 }}
          href="/customize/privacy"
        >
          <p className="text-eyebrow">Privacy and audit</p>
          <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
            Consent to learn from your data, and a ledger of what left this machine. In
            personal mode each read of these snapshots is audited.
          </p>
          <span className="text-foreground mt-auto pt-3 text-sm font-medium underline underline-offset-4">
            Open Privacy
          </span>
        </BentoCard>
      </BentoGrid>

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
