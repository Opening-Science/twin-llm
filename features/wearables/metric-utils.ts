import { formatMetricValue, metricLabel } from "@/infrastructure/format-measure";
import type { OuraMetric, OuraSummary } from "@/infrastructure/oura-types";
import type { WhoopMetric, WhoopSummary } from "@/infrastructure/whoop-types";
import type {
  GoogleHealthMetric,
  GoogleHealthSummary,
} from "@/infrastructure/google-health-types";

import type { ChartPoint } from "./interactive-chart";

export type Metric = OuraMetric | WhoopMetric | GoogleHealthMetric;
export type Summary = OuraSummary | WhoopSummary | GoogleHealthSummary;

/** Display value and label come from the shared formatter, never the raw stored number. */
export const formatValue = (metric: Metric): string => formatMetricValue(metric);

export const displayLabel = (metric: Metric): string =>
  metricLabel(metric.key, metric.label);

export const numericValue = (metric: Metric | null | undefined): number | null => {
  if (!metric) return null;
  return typeof metric.value === "number" ? metric.value : Number(metric.value);
};

export const latestByPrefix = (
  metrics: readonly Metric[],
  prefix: string,
): Metric | null => {
  const matches = metrics.filter((m) => m.key.startsWith(prefix));
  if (matches.length === 0) return null;
  // Prefer long_sleep / higher duration when duplicates share a day.
  return [...matches].sort((a, b) => {
    const dateCmp = (b.date ?? "").localeCompare(a.date ?? "");
    if (dateCmp !== 0) return dateCmp;
    const aLong = a.key.includes("long_sleep") ? 1 : 0;
    const bLong = b.key.includes("long_sleep") ? 1 : 0;
    if (bLong !== aLong) return bLong - aLong;
    const aNum = typeof a.value === "number" ? a.value : 0;
    const bNum = typeof b.value === "number" ? b.value : 0;
    return bNum - aNum;
  })[0];
};

export const pointsByPrefix = (
  metrics: readonly Metric[],
  prefix: string,
): ChartPoint[] => {
  const points = [...metrics]
    .filter((m) => m.key.startsWith(prefix) && typeof m.value === "number" && m.date)
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  // One point per day (prefer later / longer entries already ordered).
  const byDay = new Map<string, ChartPoint>();
  for (const m of points) {
    byDay.set(m.date!, { date: m.date!, value: m.value as number });
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
};

export const seriesByPrefix = (metrics: readonly Metric[], prefix: string): number[] =>
  pointsByPrefix(metrics, prefix).map((p) => p.value);

export const filterMetricsByRange = (
  metrics: readonly Metric[],
  startDate: string,
  endDate: string,
): Metric[] =>
  metrics.filter((m) => {
    if (!m.date) return true;
    return m.date >= startDate && m.date <= endDate;
  });

export const scoreBand = (score: number | null): string => {
  if (score === null) return "No reading";
  if (score >= 85) return "Optimal";
  if (score >= 70) return "Solid";
  if (score >= 60) return "Fair";
  return "Pay attention";
};

export const groupMetrics = (
  metrics: readonly Metric[],
  groups: readonly { title: string; match: (key: string) => boolean }[],
) => {
  const used = new Set<string>();
  const sections = groups.map((group) => {
    const rows = metrics.filter((m) => group.match(m.key));
    for (const row of rows) used.add(row.key);
    return { title: group.title, metrics: rows };
  });
  const other = metrics.filter((m) => !used.has(m.key));
  if (other.length > 0) sections.push({ title: "Other", metrics: other });
  return sections.filter((s) => s.metrics.length > 0);
};

/** Shared compare rows — best-effort alignment across Oura / Whoop keys. */
export const COMPARE_ROWS = [
  {
    id: "sleep",
    label: "Sleep score",
    oura: "sleep.score.",
    whoop: "whoop.sleep.performance.",
  },
  {
    id: "recovery",
    label: "Readiness / recovery",
    oura: "readiness.score.",
    whoop: "whoop.recovery.score.",
  },
  {
    id: "load",
    label: "Activity / strain",
    oura: "activity.score.",
    whoop: "whoop.cycle.strain.",
  },
  {
    id: "hr",
    label: "Resting / sleep HR",
    oura: "sleep.hr.",
    whoop: "whoop.recovery.rhr.",
  },
] as const;
