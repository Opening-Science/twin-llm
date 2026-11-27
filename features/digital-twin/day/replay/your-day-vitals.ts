import { readingInSeriesAt, seriesOf } from "@/packages/query-tools/replay/at-time";
import { isAvailable, type ReplayReading } from "@/packages/query-tools/replay/items";
import { type ReplayDay, type ReplayKey } from "@/packages/query-tools/replay/replay-day";
import { MEASURES } from "@/packages/personal-data/wearable-measure-codes";
import { LOINC_SYSTEM } from "@/packages/query-tools/imported-ports";

import { type YourDayChartDefinition } from "../charts/your-day-charts";

type VitalMetric = "heart" | "blood" | "sensor";
type VitalGroup = "heart" | "glucose";
type VitalScope = ReplayKey & Pick<ReplayDay, "origin">;

export type VitalSeries = Readonly<{
  id: YourDayChartDefinition["id"];
  metric: VitalMetric;
  source: string;
  readings: readonly ReplayReading[];
}>;

const personalMetric = (code: string | null, unit: string): VitalMetric | null => {
  if (code === MEASURES.heartRate.code && (unit === "/min" || unit === "/h")) {
    return "heart";
  }
  if (unit !== "mg/dL" && unit !== "g/L") return null;
  if (code === "99504-3") return "sensor";
  return code === "2339-0" || code === "2345-7" ? "blood" : null;
};

export function vitalSeriesForChart(
  chart: YourDayChartDefinition,
  scope: VitalScope,
  day?: ReplayDay,
): VitalSeries | null {
  const { selector, observations, id } = chart;
  if (selector) {
    const metric =
      selector.stream === "heart_rate"
        ? "heart"
        : selector.stream === "glucose"
          ? selector.specimen
          : null;
    return metric && day
      ? {
          id,
          metric,
          source: chart.sources.join(", "),
          readings: seriesOf(day, selector),
        }
      : null;
  }
  const first = observations?.[0];
  if (!first || first.codeSystem !== LOINC_SYSTEM || first.timing !== "observation") {
    return null;
  }
  const metric = personalMetric(first.code, first.unit);
  if (metric === null) return null;

  const readings = (observations ?? []).flatMap<ReplayReading>((row) => {
    if (row.day !== scope.day) return [];
    const value = row.value * chart.view.scale;
    if (!Number.isFinite(value) || value <= 0) return [];
    const base = {
      subject_ref: scope.subject_ref,
      day: scope.day,
      time_zone: scope.time_zone,
      origin: scope.origin,
      id: row.id,
      at: row.at,
      // Discrete personal observations do not describe an interval.
      interval_min: 1,
      timing: "observation",
      provenance: "measured",
      source: { kind: "device", name: row.source },
      availability: "available",
      value,
    } as const;
    return metric === "heart"
      ? [{ ...base, stream: "heart_rate", unit: "/min" }]
      : [{ ...base, stream: "glucose", specimen: metric, unit: "mg/dL" }];
  });
  return { id, metric, source: first.source, readings };
}

export function availableVitalSeries(series: Iterable<VitalSeries>, group: VitalGroup) {
  return [...series].filter(
    ({ metric, readings }) =>
      (group === "heart" ? metric === "heart" : metric !== "heart") &&
      readings.some(isAvailable),
  );
}

export function defaultVitalSeries(series: readonly VitalSeries[], group: VitalGroup) {
  const options = availableVitalSeries(series, group);
  return options.find(({ metric }) => metric === "sensor") ?? options[0];
}

export const vitalReadingAt = (series: VitalSeries | undefined, cursorMs: number) =>
  readingInSeriesAt(series?.readings ?? [], cursorMs);

/** A fixed display scale, not a clinical threshold. The clip always runs at 1x. */
export const glucoseParticleDensity = (mgDl: number | null): number =>
  mgDl === null ? 0 : Math.min(1, Math.max(0, mgDl / 300));
