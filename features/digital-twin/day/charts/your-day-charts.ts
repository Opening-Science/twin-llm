import { type OrganSystem, type SystemId } from "@/packages/anatomy/systems";
import { type Biomarker } from "@/packages/biomarkers/anchor-layer";
import { VITAL_ANATOMY } from "@/packages/biomarkers/vitals";
import { MEASURES, type Measure } from "@/packages/personal-data/wearable-measure-codes";
import { LOINC_SYSTEM } from "@/packages/query-tools/imported-ports";
import { type SeriesSelector } from "@/packages/query-tools/replay/at-time";
import { isAvailable, type ReplayReading } from "@/packages/query-tools/replay/items";
import { type ReplayDay } from "@/packages/query-tools/replay/replay-day";
import {
  type ReferenceBand,
  type Unavailable,
} from "@/packages/query-tools/replay/nights";

import { YOUR_DAY_COPY } from "../../twin-page-copy";
import { vendorMeasureKey } from "./vendor-measures";
import { chartPresentation, unitIdentity } from "./your-day-chart-units";
import { type DayObservation } from "./your-day-observations";

type MeasureKey = keyof typeof MEASURES;
type Identity = Readonly<{
  codeSystem: string | null;
  code: string | null;
  unit: string;
}>;

export const MEASURE_SYSTEMS: Partial<Record<MeasureKey, SystemId>> = {
  heartRate: VITAL_ANATOMY.heartRate.system,
  restingHeartRate: VITAL_ANATOMY.rhr.system,
  hrvSdnn: VITAL_ANATOMY.hrv.system,
  hrvRmssd: VITAL_ANATOMY.hrv.system,
  steps: VITAL_ANATOMY.steps.system,
  stepsPerDay: VITAL_ANATOMY.steps.system,
  oxygenSaturation: VITAL_ANATOMY.spo2.system,
  respiratoryRate: VITAL_ANATOMY.respiration.system,
  sleepDuration: VITAL_ANATOMY.sleep.system,
  lowestSleepHeartRate: VITAL_ANATOMY.heartRate.system,
  workoutHeartRate: VITAL_ANATOMY.heartRate.system,
};

/** The registry measure a reading records: same code (or name, when uncoded) and unit. */
export function measureKeyFor(row: Identity & Readonly<{ label: string }>) {
  const alias = vendorMeasureKey(row.codeSystem, row.code);
  if (alias) {
    return unitIdentity(row.unit) === unitIdentity(MEASURES[alias].unit)
      ? alias
      : undefined;
  }
  return (Object.keys(MEASURES) as MeasureKey[]).find((key) => {
    const measure: Measure = MEASURES[key];
    const sameCode =
      measure.code === null
        ? row.code === null && row.label === measure.display
        : row.codeSystem === measure.codeSystem && row.code === measure.code;
    return sameCode && unitIdentity(row.unit) === unitIdentity(measure.unit);
  });
}

/** The one unblocked Anchor marker with this LOINC code and unit, if exactly one exists. */
export function anchorMarkerFor(markers: readonly Biomarker[], row: Identity) {
  if (row.codeSystem !== LOINC_SYSTEM || !row.code) return undefined;
  const matches = markers.filter(
    (marker) =>
      marker.loincCode === row.code &&
      unitIdentity(marker.unitUcum) === unitIdentity(row.unit) &&
      !marker.blocked,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

const wearable = {
  heart_rate: { measure: MEASURES.heartRate, system: VITAL_ANATOMY.heartRate.system },
  steps: { measure: MEASURES.steps, system: VITAL_ANATOMY.steps.system },
  resting_heart_rate: {
    measure: MEASURES.restingHeartRate,
    system: VITAL_ANATOMY.rhr.system,
  },
  hrv_rmssd: { measure: MEASURES.hrvRmssd, system: VITAL_ANATOMY.hrv.system },
} satisfies Record<
  Exclude<ReplayReading["stream"], "glucose">,
  { measure: Measure; system: SystemId }
>;

export type YourDayChartId =
  ReplayReading["stream"] | "blood_glucose" | `observations:${string}`;
export type YourDayChartDefinition = Readonly<{
  id: YourDayChartId;
  selector: SeriesSelector | null;
  view: ReturnType<typeof chartPresentation>;
  label: string;
  system: OrganSystem;
  measure: Measure | null;
  sources: readonly string[];
  marker?: Biomarker;
  observations?: readonly DayObservation[];
}>;
export const MAX_YOUR_DAY_CHARTS = 6;

/** Discover across the replay span, so a chart stays selected on days with gaps. */
export function discoverYourDayCharts(
  days: readonly ReplayDay[],
): YourDayChartDefinition[] {
  const charts = new Map<
    YourDayChartId,
    Omit<YourDayChartDefinition, "sources"> & {
      sources: Set<string>;
    }
  >();
  for (const day of days) {
    for (const reading of day.readings) {
      if (!isAvailable(reading)) continue;
      const { stream, unit, source } = reading;
      const id =
        stream === "glucose" && reading.specimen === "blood" ? "blood_glucose" : stream;
      const existing = charts.get(id);
      if (existing) {
        existing.sources.add(source.name);
        continue;
      }
      const { measure, system } =
        stream === "glucose"
          ? { measure: null, system: "metabolic" as const }
          : wearable[stream];
      const selector: SeriesSelector =
        stream === "glucose" ? { stream, specimen: reading.specimen } : { stream };
      const label =
        measure?.display ??
        (id === "blood_glucose"
          ? YOUR_DAY_COPY.chart.bloodGlucose
          : YOUR_DAY_COPY.chart.glucose);
      charts.set(id, {
        id,
        selector,
        view: chartPresentation(unit, label, reading.timing),
        label,
        system,
        measure,
        sources: new Set([source.name]),
      });
    }
  }
  return [...charts.values()].map(({ sources, ...chart }) => ({
    ...chart,
    sources: [...sources].sort(),
  }));
}

export function toggleYourDayChart(draft: readonly YourDayChartId[], id: YourDayChartId) {
  if (draft.includes(id)) return draft.filter((chartId) => chartId !== id);
  return draft.length < MAX_YOUR_DAY_CHARTS ? [...draft, id] : draft;
}

// Replay step buckets are keyed by their start, including on DST days.
export const intervalEndMs = (startMs: number, intervalMin: number): number =>
  startMs + intervalMin * 60_000;

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
export type YourDayChartData = Readonly<{
  day: ReplayDay;
  bands?: Readonly<
    Record<"resting_heart_rate" | "hrv_rmssd", ReferenceBand | Unavailable>
  >;
}>;
