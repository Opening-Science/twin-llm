import type { VitronicSummary } from "@/infrastructure/vitronic-types";
import { presentSummaryMetric, UNIT_M, UNIT_RAD } from "./present-measure";

export { UNIT_CM, UNIT_DEG, UNIT_M, UNIT_RAD } from "./present-measure";

/** SI units for BodyLoop `properties` (scan export, 29 Sep 2026). Never convert. */
export const UNIT_M2 = "m2";
export const UNIT_M3 = "m3";
export const UNIT_KG = "kg";
export const UNIT_BMI = "kg/m2";

export const PROPERTY_SI_UNITS: Readonly<Record<string, string>> = {
  "body.height": UNIT_M,
  "body.surface": UNIT_M2,
  "body.volume": UNIT_M3,
  "body.mass": UNIT_KG,
  "body.bmi": UNIT_BMI,
};

export const unitForPropertyPath = (path: string): string | null =>
  PROPERTY_SI_UNITS[path] ?? null;

export type VitronicSummaryInput = Readonly<{
  scanId: string;
  effectiveDateTime?: string;
  height?: readonly { readonly height_path: string; readonly height: number }[];
  distance?: readonly {
    readonly distance_path: string;
    readonly distances: { readonly linear_distance: number };
  }[];
  angle?: readonly {
    readonly angle_path: string;
    readonly angles: { readonly primary: number };
  }[];
  cross_section?: unknown;
  properties?: readonly { readonly property_path: string; readonly value: unknown }[];
}>;

const dayKey = (iso?: string): string => {
  if (!iso) return "unknown";
  return iso.slice(0, 10);
};

const asNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
};

type CrossSectionRow = {
  readonly crosssection_path: string;
  readonly circumferences?: Record<string, number> | null;
};

const asCrossSections = (value: unknown): readonly CrossSectionRow[] => {
  if (!Array.isArray(value)) return [];
  const rows: CrossSectionRow[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const path = (item as { crosssection_path?: unknown }).crosssection_path;
    if (typeof path !== "string" || path.length === 0) continue;
    const raw = (item as { circumferences?: unknown }).circumferences;
    let circumferences: Record<string, number> | null = null;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      const next: Record<string, number> = {};
      for (const [name, measure] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof measure === "number" && Number.isFinite(measure)) next[name] = measure;
      }
      circumferences = next;
    }
    rows.push({ crosssection_path: path, circumferences });
  }
  return rows;
};

/**
 * Compact citation keys for chat. Mesh bytes never enter this object.
 * Properties use SI units from the scanner export. Height/distance/circumference/angle
 * lists are stored as metres and radians (API payload scale class). Chat converts
 * via presentSummaryMetric; the UI uses presentMeasure. Values are stored as received.
 */
export const buildVitronicSummary = (input: VitronicSummaryInput): VitronicSummary => {
  const date = dayKey(input.effectiveDateTime);
  const metrics: VitronicSummary["metrics"][number][] = [];

  for (const row of input.height ?? []) {
    metrics.push({
      key: `vitronic.height.${row.height_path}.${date}`,
      label: `BodyLoop height ${row.height_path} (${date})`,
      value: row.height,
      date,
      unit: UNIT_M,
    });
  }

  for (const row of input.distance ?? []) {
    metrics.push({
      key: `vitronic.distance.${row.distance_path}.${date}`,
      label: `BodyLoop distance ${row.distance_path} (${date})`,
      value: row.distances.linear_distance,
      date,
      unit: UNIT_M,
    });
  }

  for (const row of asCrossSections(input.cross_section)) {
    for (const [name, value] of Object.entries(row.circumferences ?? {})) {
      metrics.push({
        key: `vitronic.circumference.${row.crosssection_path}.${name}.${date}`,
        label: `BodyLoop circumference ${row.crosssection_path} ${name} (${date})`,
        value,
        date,
        unit: UNIT_M,
      });
    }
  }

  for (const row of input.angle ?? []) {
    metrics.push({
      key: `vitronic.angle.${row.angle_path}.${date}`,
      label: `BodyLoop angle ${row.angle_path} (${date})`,
      value: row.angles.primary,
      date,
      unit: UNIT_RAD,
    });
  }

  for (const row of input.properties ?? []) {
    const value = asNumber(row.value);
    if (value === null) continue;
    const unit = unitForPropertyPath(row.property_path);
    if (!unit) continue;
    metrics.push({
      key: `vitronic.property.${row.property_path}.${date}`,
      label: `BodyLoop ${row.property_path} (${date})`,
      value,
      date,
      unit,
    });
  }

  return {
    window: { startDate: date, endDate: date },
    metrics,
    narrative: `BodyLoop scan measurements for ${date}. The 3D mesh stays on Digital Twin.`,
  };
};

export type VitronicPropertyRow = Readonly<{
  path: string;
  value: number;
  unit: string;
}>;

/** Numeric chat keys only: vitronic.property.* and vitronic.<kind>.<path> with a unit. */
export const CHAT_SUMMARY_KEY_RE =
  /^vitronic\.(property|height|distance|circumference|angle)\./;

const GEOMETRY_SEGMENT = /(?:^|\.)(?:positions?|contours?|mesh|markers?)(?:\.|$)/i;
const GEOMETRY_WORD = /\b(?:positions?|contours?|mesh|markers?)\b/i;

export const CHAT_NARRATIVE = "BodyLoop numeric measurements with units.";

export const isChatVitronicMetric = (
  metric: VitronicSummary["metrics"][number],
): boolean => {
  if (typeof metric.value !== "number" || !Number.isFinite(metric.value)) return false;
  if (typeof metric.unit !== "string" || metric.unit.trim().length === 0) return false;
  if (!CHAT_SUMMARY_KEY_RE.test(metric.key)) return false;
  if (GEOMETRY_SEGMENT.test(metric.key) || GEOMETRY_WORD.test(metric.label)) return false;
  return true;
};

export const toChatVitronicSummary = (summary: VitronicSummary): VitronicSummary => ({
  window: summary.window,
  narrative: CHAT_NARRATIVE,
  metrics: summary.metrics.filter(isChatVitronicMetric).map(presentSummaryMetric),
});

export const propertyRowsFromSummary = (summary: VitronicSummary): readonly VitronicPropertyRow[] => {
  const rows: VitronicPropertyRow[] = [];
  for (const metric of summary.metrics) {
    const match = /^vitronic\.property\.(.+)\.(?:\d{4}-\d{2}-\d{2}|unknown)$/.exec(metric.key);
    if (!match?.[1]) continue;
    if (typeof metric.value !== "number" || !metric.unit) continue;
    rows.push({ path: match[1], value: metric.value, unit: metric.unit });
  }
  return rows;
};
