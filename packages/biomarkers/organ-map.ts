/**
 * Biomarker → organ, for reading a person's values organ by organ. TwinLLM-
 * authored, reviewed, research use. An organ is an HRA organ-group key from
 * packages/anatomy/hra-groups.ts, so the twin can find its mesh. Only markers
 * that clearly belong to one organ are listed; docs/biomarkers.md has the table
 * with what is left out and why.
 */
import { anchorLayer, type AnchorLayer } from "./anchor-layer";
import { referenceIntervalFor } from "./catalogue";
import { intervalPosition, type IntervalPosition } from "./interval-position";
import { type PopulationContext } from "./population";

export type OrganMapping = Readonly<{ loinc: string; organ: string }>;

export const ORGAN_MAP: readonly OrganMapping[] = [
  { loinc: "1742-6", organ: "liver" }, // GPT (ALAT)
  { loinc: "1920-8", organ: "liver" }, // GOT (ASAT)
  { loinc: "2324-2", organ: "liver" }, // Gamma-GT (GGT)
  { loinc: "2160-0", organ: "kidney" }, // Kreatinin
  { loinc: "4548-4", organ: "pancreas" }, // HbA1c
  { loinc: "1558-6", organ: "pancreas" }, // Glukose
  { loinc: "2093-3", organ: "bloodvasculature" }, // Cholesterin (gesamt)
  { loinc: "2085-9", organ: "bloodvasculature" }, // HDL-Cholesterin
  { loinc: "2089-1", organ: "bloodvasculature" }, // LDL-Cholesterin
  { loinc: "2571-8", organ: "bloodvasculature" }, // Triglyceride
  { loinc: "10835-7", organ: "bloodvasculature" }, // Lipoprotein (a)
];

/** A measured value as the Biomarkers tab receives it; nothing is converted. */
export type MarkerValue = Readonly<{ loinc: string; value: number; unitUcum: string }>;

export type OrganStatus = Readonly<{
  organ: string;
  position: Exclude<IntervalPosition, "unknown">;
  markerId: string;
  loinc: string;
  /** The marker's name as the Biomarkers tab shows it. */
  label: string;
}>;

const DISTANCE: Readonly<Record<IntervalPosition, number>> = {
  unknown: 0,
  within: 1,
  below: 2,
  above: 2,
};

/**
 * Per organ, the marker furthest from its published range: above or below
 * beats within, and the first marker in the table keeps a tie. A value with no
 * position (no fitting interval, another unit, D11) sets nothing. Organs come
 * in table order; an organ without a positioned value is absent.
 */
export const organStatus = (
  values: readonly MarkerValue[],
  context: PopulationContext = {},
  layer: AnchorLayer = anchorLayer,
): readonly OrganStatus[] => {
  const byLoinc = new Map(values.map((value) => [value.loinc, value]));
  const found = new Map<string, OrganStatus>();
  for (const { loinc, organ } of ORGAN_MAP) {
    const value = byLoinc.get(loinc);
    const marker = layer.biomarkers.find((row) => row.loincCode === loinc);
    if (!value || !marker) continue;
    const interval = referenceIntervalFor(marker.id, context, layer);
    const position = intervalPosition(value.value, value.unitUcum, interval);
    if (position === "unknown") continue;
    const current = found.get(organ);
    if (current && DISTANCE[current.position] >= DISTANCE[position]) continue;
    found.set(organ, {
      organ,
      position,
      markerId: marker.id,
      loinc,
      label: marker.nameDe,
    });
  }
  return [...found.values()];
};
