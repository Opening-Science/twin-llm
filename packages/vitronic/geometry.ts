/**
 * BodyLoop marker / measure geometry for the snapshot and viewer.
 * Never copied into chat keys.
 */

import { UNIT_M, UNIT_RAD } from "./present-measure";

export type MarkerSource = "auto" | "palpation" | "custom";

export const MARKER_GROUPS = ["head", "torso", "arm", "avatar", "leg"] as const;
export type MarkerGroup = (typeof MARKER_GROUPS)[number] | "other";

export type StoredMarker = Readonly<{
  path: string;
  label: string;
  group: MarkerGroup;
  source: MarkerSource;
  position: readonly [number, number, number];
}>;

export type MeasureKind = "height" | "distance" | "crosssection" | "angle";

export type StoredMeasure = Readonly<{
  kind: MeasureKind;
  path: string;
  label: string;
  value: number;
  unit: string;
  markerRefs: readonly string[];
  positions: readonly (readonly [number, number, number])[];
  contours?: unknown;
}>;

export type StoredGeometry = Readonly<{
  markers: readonly StoredMarker[];
  measures: readonly StoredMeasure[];
}>;

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const asFiniteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

export const asPosition = (value: unknown): readonly [number, number, number] | null => {
  if (!Array.isArray(value) || value.length < 3) return null;
  const x = asFiniteNumber(value[0]);
  const y = asFiniteNumber(value[1]);
  const z = asFiniteNumber(value[2]);
  if (x === null || y === null || z === null) return null;
  return [x, y, z];
};

export const markerSourceFromType = (markerType: unknown): MarkerSource => {
  const raw = typeof markerType === "string" ? markerType.toLowerCase() : "";
  if (raw.includes("palp")) return "palpation";
  if (raw.includes("custom")) return "custom";
  return "auto";
};

export const groupFromPath = (path: string): MarkerGroup => {
  const head = path.split(".")[0]?.toLowerCase() ?? "";
  if (head === "head") return "head";
  if (head === "torso") return "torso";
  if (head === "arm" || head === "arms") return "arm";
  if (head === "leg" || head === "legs") return "leg";
  if (head === "avatar") return "avatar";
  return "other";
};

const markerFromRow = (row: unknown): StoredMarker | null => {
  const rec = asRecord(row);
  if (!rec) return null;
  const path = asString(rec.marker_path);
  const position = asPosition(rec.position);
  if (!path || !position) return null;
  const label = asString(rec.label) ?? path;
  return {
    path,
    label,
    group: groupFromPath(path),
    source: markerSourceFromType(rec.marker_type),
    position,
  };
};

const detailsMarker = (
  details: unknown,
  key: string,
): { readonly path: string; readonly position: readonly [number, number, number] } | null => {
  const rec = asRecord(details);
  if (!rec) return null;
  const nested = markerFromRow(rec[key]);
  if (nested) return { path: nested.path, position: nested.position };
  return null;
};

const rowsFromUnknown = (value: unknown): readonly unknown[] => {
  if (Array.isArray(value)) return value;
  const rec = asRecord(value);
  if (!rec) return [];
  return Object.values(rec).flatMap((entry) => {
    if (Array.isArray(entry)) return entry;
    const inner = asRecord(entry);
    if (inner) return Object.values(inner);
    return [entry];
  });
};

export const parseMarkers = (value: unknown): readonly StoredMarker[] => {
  const out: StoredMarker[] = [];
  const seen = new Set<string>();
  for (const row of rowsFromUnknown(value)) {
    const marker = markerFromRow(row);
    if (!marker || seen.has(marker.path)) continue;
    seen.add(marker.path);
    out.push(marker);
  }
  return out;
};

const firstNumber = (value: unknown): number | null => {
  const direct = asFiniteNumber(value);
  if (direct !== null) return direct;
  const rec = asRecord(value);
  if (!rec) return null;
  for (const preferred of ["linear_distance", "convex_circumference", "primary"]) {
    const hit = asFiniteNumber(rec[preferred]);
    if (hit !== null) return hit;
  }
  for (const entry of Object.values(rec)) {
    const hit = asFiniteNumber(entry);
    if (hit !== null) return hit;
  }
  return null;
};

export const parseMeasures = (input: {
  readonly height?: unknown;
  readonly distance?: unknown;
  readonly angle?: unknown;
  readonly cross_section?: unknown;
  readonly markers?: readonly StoredMarker[];
}): readonly StoredMeasure[] => {
  const byPath = new Map(input.markers?.map((row) => [row.path, row]) ?? []);
  const measures: StoredMeasure[] = [];

  for (const row of rowsFromUnknown(input.height)) {
    const rec = asRecord(row);
    if (!rec) continue;
    const path = asString(rec.height_path);
    const value = asFiniteNumber(rec.height);
    if (!path || value === null) continue;
    const at = asString(rec.at_marker);
    const detailed = detailsMarker(rec.details, "at_marker");
    const fromMap = at ? byPath.get(at) : undefined;
    const position = detailed?.position ?? fromMap?.position;
    measures.push({
      kind: "height",
      path,
      label: asString(rec.label) ?? path,
      value,
      unit: UNIT_M,
      markerRefs: at ? [at] : detailed ? [detailed.path] : [],
      positions: position ? [position] : [],
    });
  }

  for (const row of rowsFromUnknown(input.distance)) {
    const rec = asRecord(row);
    if (!rec) continue;
    const path = asString(rec.distance_path);
    const value = firstNumber(rec.distances);
    if (!path || value === null) continue;
    const fromRef = asString(rec.from_marker);
    const toRef = asString(rec.to_marker);
    const from = detailsMarker(rec.details, "from_marker") ?? (fromRef ? { path: fromRef, position: byPath.get(fromRef)?.position ?? null } : null);
    const to = detailsMarker(rec.details, "to_marker") ?? (toRef ? { path: toRef, position: byPath.get(toRef)?.position ?? null } : null);
    const positions = [from?.position, to?.position].filter(
      (item): item is readonly [number, number, number] => Boolean(item),
    );
    measures.push({
      kind: "distance",
      path,
      label: asString(rec.label) ?? path,
      value,
      unit: UNIT_M,
      markerRefs: [fromRef, toRef].filter((item): item is string => Boolean(item)),
      positions,
    });
  }

  for (const row of rowsFromUnknown(input.cross_section)) {
    const rec = asRecord(row);
    if (!rec) continue;
    const path = asString(rec.crosssection_path);
    const value = firstNumber(rec.circumferences);
    if (!path || value === null) continue;
    const at = asString(rec.at_marker);
    const detailed = detailsMarker(rec.details, "at_marker");
    const fromMap = at ? byPath.get(at) : undefined;
    const position = detailed?.position ?? fromMap?.position;
    measures.push({
      kind: "crosssection",
      path,
      label: asString(rec.label) ?? path,
      value,
      unit: UNIT_M,
      markerRefs: at ? [at] : detailed ? [detailed.path] : [],
      positions: position ? [position] : [],
      contours: rec.contours ?? undefined,
    });
  }

  for (const row of rowsFromUnknown(input.angle)) {
    const rec = asRecord(row);
    if (!rec) continue;
    const path = asString(rec.angle_path);
    const value = firstNumber(rec.angles);
    if (!path || value === null) continue;
    const atRef = asString(rec.at_marker);
    const fromRef = asString(rec.from_marker);
    const toRef = asString(rec.to_marker);
    const at = detailsMarker(rec.details, "at_marker") ?? (atRef ? { path: atRef, position: byPath.get(atRef)?.position ?? null } : null);
    const from = detailsMarker(rec.details, "from_marker") ?? (fromRef ? { path: fromRef, position: byPath.get(fromRef)?.position ?? null } : null);
    const to = detailsMarker(rec.details, "to_marker") ?? (toRef ? { path: toRef, position: byPath.get(toRef)?.position ?? null } : null);
    const positions = [from?.position, at?.position, to?.position].filter(
      (item): item is readonly [number, number, number] => Boolean(item),
    );
    measures.push({
      kind: "angle",
      path,
      label: asString(rec.label) ?? path,
      value,
      unit: UNIT_RAD,
      markerRefs: [fromRef, atRef, toRef].filter((item): item is string => Boolean(item)),
      positions,
    });
  }

  return measures;
};

export const buildStoredGeometry = (input: {
  readonly marker?: unknown;
  readonly height?: unknown;
  readonly distance?: unknown;
  readonly angle?: unknown;
  readonly cross_section?: unknown;
}): StoredGeometry => {
  const markers = parseMarkers(input.marker);
  const measures = parseMeasures({
    height: input.height,
    distance: input.distance,
    angle: input.angle,
    cross_section: input.cross_section,
    markers,
  });
  return { markers, measures };
};

export const jsonHasGeometry = (value: unknown): boolean => {
  const text = JSON.stringify(value);
  return (
    text.includes('"position"') ||
    text.includes('"positions"') ||
    text.includes('"contours"') ||
    text.includes('"contour"')
  );
};

export const asStoredMarkers = (value: unknown): readonly StoredMarker[] => {
  if (!Array.isArray(value)) return [];
  const out: StoredMarker[] = [];
  for (const row of value) {
    const rec = asRecord(row);
    if (!rec) continue;
    const path = asString(rec.path);
    const position = asPosition(rec.position);
    if (!path || !position) continue;
    const source = rec.source === "palpation" || rec.source === "custom" ? rec.source : "auto";
    const group = groupFromPath(typeof rec.group === "string" ? rec.group : path);
    out.push({
      path,
      label: asString(rec.label) ?? path,
      group,
      source,
      position,
    });
  }
  return out;
};

export const asStoredMeasures = (value: unknown): readonly StoredMeasure[] => {
  if (!Array.isArray(value)) return [];
  const out: StoredMeasure[] = [];
  const kinds = new Set(["height", "distance", "crosssection", "angle"]);
  for (const row of value) {
    const rec = asRecord(row);
    if (!rec) continue;
    const kind = String(rec.kind);
    const path = asString(rec.path);
    const numeric = asFiniteNumber(rec.value);
    if (!kinds.has(kind) || !path || numeric === null) continue;
    const positions = Array.isArray(rec.positions)
      ? rec.positions
          .map((item) => asPosition(item))
          .filter((item): item is readonly [number, number, number] => item !== null)
      : [];
    const markerRefs = Array.isArray(rec.markerRefs)
      ? rec.markerRefs.filter((item): item is string => typeof item === "string")
      : [];
    out.push({
      kind: kind as MeasureKind,
      path,
      label: asString(rec.label) ?? path,
      value: numeric,
      unit: asString(rec.unit) ?? "",
      markerRefs,
      positions,
      contours: rec.contours,
    });
  }
  return out;
};
