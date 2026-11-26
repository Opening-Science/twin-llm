import { type SystemId } from "@/packages/anatomy/systems";
import { type Biomarker } from "@/packages/biomarkers/anchor-layer";
import { listBiomarkers } from "@/packages/biomarkers/catalogue";
import { VITAL_ANATOMY } from "@/packages/biomarkers/vitals";
import { MEASURES, type Measure } from "@/packages/personal-data/wearable-measure-codes";
import { type ReplayDay } from "@/packages/query-tools/replay/replay-day";

import { SYSTEM_LABEL } from "../anatomy/anatomy-copy";
import { VITAL_LABEL } from "../biomarkers/biomarker-copy";
import { YOUR_DAY_COPY } from "../twin-page-copy";
import { chartUnitFor } from "./your-day-chart-units";
import { type DayObservation, observationCharts } from "./your-day-observations";
import {
  discoverYourDayCharts,
  type YourDayChartDefinition,
  type YourDayChartId,
} from "./your-day-charts";

type PickerEntry = Readonly<{
  id: string;
  chartId: YourDayChartId | null;
  label: string;
  unit: string | null;
  category: string;
  provider: string;
  description: string;
  search: string;
  unavailableReason?: string;
}>;

const anchorId = (marker: Biomarker) => `anchor:${marker.id}`;
const anchorSearch = (marker: Biomarker) =>
  `${marker.nameDe} ${marker.loincCode} ${marker.id} ${marker.unitUcum}`;

const wearableSystems: Partial<Record<keyof typeof MEASURES, SystemId>> = {
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

export function buildPickerCatalog(
  days: readonly ReplayDay[],
  markers: readonly Biomarker[] = listBiomarkers(),
  observations: readonly DayObservation[] = [],
) {
  const charts = [...discoverYourDayCharts(days), ...observationCharts(observations)];
  const chartsByMeasure = new Map(charts.map((chart) => [chart.measure, chart]));
  const matched = new Set<string>();
  const wearableEntries: PickerEntry[] = [];
  for (const key of Object.keys(MEASURES) as (keyof typeof MEASURES)[]) {
    const measure: Measure = MEASURES[key];
    const chart = chartsByMeasure.get(measure);
    const matches =
      measure.codeSystem === "http://loinc.org" && measure.code
        ? markers.filter(
            (marker) =>
              marker.loincCode === measure.code &&
              marker.unitUcum === measure.unit &&
              !marker.blocked,
          )
        : [];
    const marker = matches.length === 1 ? matches[0] : undefined;
    if (marker) matched.add(marker.id);
    wearableEntries.push({
      id: marker ? anchorId(marker) : (chart?.id ?? `wearable:${key}`),
      chartId: chart?.id ?? null,
      label: measure.display,
      unit: chart?.view.label ?? chartUnitFor(measure.unit, measure.display).label,
      category: SYSTEM_LABEL[marker?.systemId ?? wearableSystems[key] ?? "unassigned"],
      provider: chart?.sources.join(", ") ?? "Wearable measurement catalog",
      description:
        marker?.loincDisplay ??
        (chart ? "Time series in Day Replay." : "Wearable measurement."),
      search: `${measure.code ?? ""} ${measure.unit} ${marker ? anchorSearch(marker) : ""}`,
    });
  }

  const entryByChart = new Map(wearableEntries.map((entry) => [entry.chartId, entry]));
  const replayOnlyEntry = (chart: YourDayChartDefinition): PickerEntry => ({
    id: chart.id,
    chartId: chart.id,
    label: chart.label,
    unit: chart.view.label,
    category: SYSTEM_LABEL[chart.system],
    provider: chart.sources.join(", "),
    description:
      chart.selector?.stream === "glucose" && chart.selector.specimen === "sensor"
        ? "Glucose readings from a continuous sensor."
        : "Time series in Day Replay.",
    search: chart.marker
      ? anchorSearch(chart.marker)
      : (chart.observations?.[0]?.code ?? ""),
  });
  const entries = charts.map(
    (chart) => entryByChart.get(chart.id) ?? replayOnlyEntry(chart),
  );
  for (const chart of charts) if (chart.marker) matched.add(chart.marker.id);

  const sleepSources = new Set(
    days.flatMap(({ events }) =>
      events.filter(({ kind }) => kind === "sleep").map(({ source }) => source.name),
    ),
  );
  if (sleepSources.size > 0) {
    entries.push({
      id: "sleep",
      chartId: null,
      label: VITAL_LABEL.sleep,
      unit: null,
      category: SYSTEM_LABEL[VITAL_ANATOMY.sleep.system],
      provider: [...sleepSources].sort().join(", "),
      description: "Sleep intervals in Day Replay.",
      search: "timeline",
      unavailableReason: "Sleep is shown on the replay timeline, not as a chart.",
    });
  }

  const labs = markers
    .filter(({ id }) => !matched.has(id))
    .map((marker): PickerEntry => ({
      id: anchorId(marker),
      chartId: null,
      label: marker.loincDisplay.split(" [")[0]!.trim() || marker.nameDe,
      unit: chartUnitFor(marker.unitUcum, marker.loincDisplay).label,
      category: SYSTEM_LABEL[marker.systemId],
      provider: YOUR_DAY_COPY.chartPicker.labProvider,
      description: marker.loincDisplay,
      search: anchorSearch(marker),
    }));
  const catalogOnly = [
    ...labs,
    ...wearableEntries.filter(({ chartId }) => chartId === null),
  ];
  entries.push(...catalogOnly.sort((a, b) => a.label.localeCompare(b.label, "en")));
  const categories = [...new Set(entries.map(({ category }) => category))].sort((a, b) =>
    a.localeCompare(b, "en"),
  );
  return { entries, categories, charts };
}

const normalize = (text: string) =>
  text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export function filterPickerCatalog(
  entries: readonly PickerEntry[],
  query: string,
  category: string,
) {
  const words = normalize(query).trim().split(/\s+/);
  return entries.filter((entry) => {
    if (category && entry.category !== category) return false;
    const text = normalize(
      `${entry.label} ${entry.provider} ${entry.description} ${entry.unit ?? ""} ${entry.search}`,
    );
    return words.every((word) => text.includes(word));
  });
}

export function paginatePickerCatalog(results: readonly PickerEntry[], page: number) {
  const pageSize = 9;
  const pageCount = Math.ceil(results.length / pageSize);
  const start = page * pageSize;
  const end = Math.min(start + pageSize, results.length);
  const windowSize = Math.min(3, pageCount);
  const windowStart = Math.max(0, Math.min(page - 1, pageCount - windowSize));

  return {
    entries: results.slice(start, end),
    firstResult: results.length === 0 ? 0 : start + 1,
    lastResult: end,
    pageCount,
    visiblePages: Array.from({ length: windowSize }, (_, index) => windowStart + index),
  };
}
