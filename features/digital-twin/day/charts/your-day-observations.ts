import { type Biomarker } from "@/packages/biomarkers/anchor-layer";
import { listBiomarkers } from "@/packages/biomarkers/catalogue";
import { MEASURES } from "@/packages/personal-data/wearable-measure-codes";
import { type AvailableReading } from "@/packages/query-tools/replay/items";

import { chartPresentation, unitIdentity } from "./your-day-chart-units";
import {
  anchorMarkerFor,
  MEASURE_SYSTEMS,
  measureKeyFor,
  type YourDayChartDefinition,
} from "./your-day-charts";

export type DayObservation = Readonly<{
  id: string;
  sourceId: string;
  source: string;
  provenance: AvailableReading["provenance"] | "imported";
  codeSystem: string | null;
  code: string | null;
  label: string;
  unit: string;
  day: string;
  at: string;
  value: number;
  timing: "observation" | "day" | "interval";
  interval_min: number;
}>;

export function observationCharts(
  rows: readonly DayObservation[],
  markers: readonly Biomarker[] = listBiomarkers(),
): YourDayChartDefinition[] {
  const groups = new Map<string, DayObservation[]>();
  for (const row of rows) {
    const identity = row.code === null ? row.label : [row.codeSystem, row.code];
    const id = JSON.stringify([
      row.sourceId,
      identity,
      unitIdentity(row.unit),
      row.timing,
    ]);
    const group = groups.get(id);
    if (group) group.push(row);
    else groups.set(id, [row]);
  }
  return [...groups].flatMap(([key, observations]) => {
    const first = observations[0];
    if (!first) return [];
    const marker = anchorMarkerFor(markers, first);
    const measureKey = measureKeyFor(first);
    return [
      {
        id: `observations:${key}`,
        selector: null,
        label: first.label,
        view: chartPresentation(first.unit, first.label, first.timing),
        system:
          marker?.systemId ?? (measureKey && MEASURE_SYSTEMS[measureKey]) ?? "unassigned",
        sources: [first.source],
        measure: measureKey ? MEASURES[measureKey] : null,
        marker,
        observations: observations.sort((a, b) => a.at.localeCompare(b.at)),
      },
    ];
  });
}
