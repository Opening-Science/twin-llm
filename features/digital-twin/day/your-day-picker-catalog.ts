import { listBiomarkers } from "@/packages/biomarkers/catalogue";
import { MEASURES } from "@/packages/personal-data/wearable-measure-codes";

import { SYSTEM_LABEL } from "../anatomy/anatomy-copy";
import { YOUR_DAY_COPY } from "../twin-page-copy";
import { chartUnit, YOUR_DAY_CHARTS, type YourDayChartId } from "./your-day-charts";

type PickerEntry = Readonly<{
  id: string;
  chartId: YourDayChartId | null;
  label: string;
  unit: string;
  category: string;
  provider: string;
  description: string;
  search: string;
}>;

const replayMeasure = {
  heart_rate: MEASURES.heartRate,
  steps: MEASURES.steps,
  resting_heart_rate: MEASURES.restingHeartRate,
  hrv_rmssd: MEASURES.hrvRmssd,
  glucose: null,
  blood_glucose: null,
} satisfies Record<YourDayChartId, unknown>;

export const BIOMARKER_PICKER_CATALOG: readonly PickerEntry[] = [
  ...Object.keys(YOUR_DAY_CHARTS)
    .filter((id): id is YourDayChartId => Object.hasOwn(YOUR_DAY_CHARTS, id))
    .map((id) => {
      const { label, category, provider, description } = YOUR_DAY_CHARTS[id];
      const measure = replayMeasure[id];
      return {
        id,
        chartId: id,
        label: measure?.display ?? label,
        unit: chartUnit(id),
        category,
        provider,
        description,
        search: `${measure?.code ?? ""} ${measure?.unit ?? ""}`,
      };
    }),
  ...listBiomarkers()
    .map((marker) => ({
      id: `anchor:${marker.id}`,
      chartId: null,
      label: marker.loincDisplay.split(" [")[0]!.trim() || marker.nameDe,
      unit: marker.unitSource || marker.unitUcum,
      category: SYSTEM_LABEL[marker.systemId],
      provider: YOUR_DAY_COPY.chartPicker.labProvider,
      description: marker.loincDisplay,
      search: `${marker.nameDe} ${marker.loincCode} ${marker.id} ${marker.unitUcum}`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "en")),
];

export const BIOMARKER_CATEGORIES = [
  ...new Set(BIOMARKER_PICKER_CATALOG.map(({ category }) => category)),
].sort((a, b) => a.localeCompare(b, "en"));

const normalize = (text: string) =>
  text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export function filterPickerCatalog(query: string, category: string) {
  const words = normalize(query).trim().split(/\s+/);
  return BIOMARKER_PICKER_CATALOG.filter((entry) => {
    if (category && entry.category !== category) return false;
    const text = normalize(
      `${entry.label} ${entry.provider} ${entry.description} ${entry.unit} ${entry.search}`,
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
