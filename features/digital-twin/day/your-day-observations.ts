import { listBiomarkers } from "@/packages/biomarkers/catalogue";
import { LOINC_SYSTEM } from "@/packages/query-tools/imported-ports";

import { chartPresentation } from "./your-day-chart-units";
import { type YourDayChartDefinition } from "./your-day-charts";

export type DayObservation = Readonly<{
  id: string;
  sourceId: string;
  source: string;
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
): YourDayChartDefinition[] {
  const markers = listBiomarkers();
  const groups = new Map<string, DayObservation[]>();
  for (const row of rows) {
    const identity = row.code === null ? row.label : [row.codeSystem, row.code];
    const id = JSON.stringify([row.sourceId, identity, row.unit, row.timing]);
    const group = groups.get(id);
    if (group) group.push(row);
    else groups.set(id, [row]);
  }
  return [...groups].flatMap(([key, observations]) => {
    const first = observations[0];
    if (!first) return [];
    const matches =
      first.codeSystem === LOINC_SYSTEM
        ? markers.filter(
            (marker) =>
              marker.loincCode === first.code &&
              marker.unitUcum === first.unit &&
              !marker.blocked,
          )
        : [];
    const marker = matches.length === 1 ? matches[0] : undefined;
    return [
      {
        id: `observations:${key}`,
        selector: null,
        label: first.label,
        view: chartPresentation(first.unit, first.label, first.timing),
        system: marker?.systemId ?? "unassigned",
        sources: [first.source],
        measure: null,
        marker,
        observations: observations.sort((a, b) => a.at.localeCompare(b.at)),
      },
    ];
  });
}
