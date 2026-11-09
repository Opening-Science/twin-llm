"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  BufferGeometry,
  Color,
  EllipseCurve,
  Float32BufferAttribute,
  Line,
  LineBasicMaterial,
  type PerspectiveCamera,
  Vector3,
} from "three";

import { formatMetricValue } from "@/infrastructure/format-measure";
import { type LegendItem } from "@/infrastructure/ui-kit/legend";
import {
  asStoredMarkers,
  asStoredMeasures,
  groupFromPath,
  MARKER_GROUPS,
  type MarkerSource,
  type MeasureKind,
  type StoredMarker,
  type StoredMeasure,
} from "@/packages/vitronic/geometry";
import { presentMeasure } from "@/packages/vitronic/present-measure";

import { type TwinToken } from "./twin-palette";
import { useTwinPalette } from "./use-twin-palette";

type ChartToken = Extract<TwinToken, `chart-${number}`>;

/**
 * Overlay colours are chart tokens, so they follow the theme and stay legible
 * on the viewer's backdrop. Seven overlays share five chart hues: markers are
 * dots, measurements are lines, and the legend always writes the word. The
 * canvas resolves a token through the twin palette and the legend draws the
 * same token as a class, so a swatch cannot drift from the dot or line it names.
 */
export const SOURCE_TOKENS: Readonly<Record<MarkerSource, ChartToken>> = {
  auto: "chart-1",
  palpation: "chart-2",
  custom: "chart-3",
};

/** Height is a reference line down to the floor, so it takes the reference grey. */
export const MEASURE_TOKENS: Readonly<Record<MeasureKind, ChartToken>> = {
  height: "chart-5",
  distance: "chart-4",
  crosssection: "chart-2",
  angle: "chart-3",
};

/** A highlighted measurement line, whatever its kind: the focus colour. */
export const HIGHLIGHT_TOKEN = "ring" satisfies TwinToken;

/** Black emissive means no glow; nobody sees it as a colour. */
const NO_GLOW = "#000000";

/** Written out so Tailwind finds every class in the source. */
const SWATCH_CLASS: Readonly<Record<ChartToken, string>> = {
  "chart-1": "text-chart-1",
  "chart-2": "text-chart-2",
  "chart-3": "text-chart-3",
  "chart-4": "text-chart-4",
  "chart-5": "text-chart-5",
};

export type OverlayToggles = Readonly<{
  auto: boolean;
  palpation: boolean;
  custom: boolean;
  heights: boolean;
  distances: boolean;
  crosssections: boolean;
  angles: boolean;
}>;

export const DEFAULT_OVERLAYS: OverlayToggles = {
  auto: true,
  palpation: true,
  custom: true,
  heights: true,
  distances: true,
  crosssections: true,
  angles: true,
};

/** One list for the View checkboxes and the legend, so their names match. */
export const OVERLAY_OPTIONS: readonly Readonly<{
  key: keyof OverlayToggles;
  label: string;
  token: ChartToken;
}>[] = [
  { key: "auto", label: "Markers · Auto", token: SOURCE_TOKENS.auto },
  { key: "palpation", label: "Markers · Palpation", token: SOURCE_TOKENS.palpation },
  { key: "custom", label: "Markers · Custom", token: SOURCE_TOKENS.custom },
  { key: "heights", label: "Heights", token: MEASURE_TOKENS.height },
  { key: "distances", label: "Distances", token: MEASURE_TOKENS.distance },
  { key: "crosssections", label: "Crosssections", token: MEASURE_TOKENS.crosssection },
  { key: "angles", label: "Angles", token: MEASURE_TOKENS.angle },
];

export const overlayLegendItems = (): readonly LegendItem[] =>
  OVERLAY_OPTIONS.map((option) => ({
    id: option.key,
    label: option.label,
    swatchClassName: SWATCH_CLASS[option.token],
  }));

export type OverlayLabel = Readonly<{
  id: string;
  text: string;
  position: readonly [number, number, number];
}>;

const vec = (point: readonly [number, number, number]): Vector3 =>
  new Vector3(point[0], point[1], point[2]);

const lineFrom = (
  points: readonly (readonly [number, number, number])[],
  color: string,
): Line => {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(
      points.flatMap((point) => [...point]),
      3,
    ),
  );
  return new Line(geometry, new LineBasicMaterial({ color: new Color(color) }));
};

const contourPoints = (
  contours: unknown,
): readonly (readonly [number, number, number])[] => {
  if (!contours || typeof contours !== "object") return [];
  const rec = contours as Record<string, unknown>;
  const first = Object.values(rec)[0];
  if (!Array.isArray(first)) return [];
  const out: Array<readonly [number, number, number]> = [];
  for (const row of first) {
    if (Array.isArray(row) && row.length >= 3) {
      const x = Number(row[0]);
      const y = Number(row[1]);
      const z = Number(row[2]);
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        out.push([x, y, z]);
      }
    }
  }
  return out;
};

export const visibleMarkers = (
  markers: readonly StoredMarker[],
  toggles: OverlayToggles,
): readonly StoredMarker[] =>
  markers.filter((row) => {
    if (row.source === "auto") return toggles.auto;
    if (row.source === "palpation") return toggles.palpation;
    return toggles.custom;
  });

export const visibleMeasures = (
  measures: readonly StoredMeasure[],
  toggles: OverlayToggles,
): readonly StoredMeasure[] =>
  measures.filter((row) => {
    if (row.kind === "height") return toggles.heights;
    if (row.kind === "distance") return toggles.distances;
    if (row.kind === "crosssection") return toggles.crosssections;
    return toggles.angles;
  });

export const OverlayPrimitives = ({
  markers,
  measures,
  highlightId,
  onHover,
}: {
  readonly markers: readonly StoredMarker[];
  readonly measures: readonly StoredMeasure[];
  readonly highlightId: string | null;
  readonly onHover: (id: string | null) => void;
}) => {
  const palette = useTwinPalette();
  const lines = useMemo(() => {
    const items: Line[] = [];
    for (const measure of measures) {
      const color =
        palette[
          highlightId === measure.path ? HIGHLIGHT_TOKEN : MEASURE_TOKENS[measure.kind]
        ];
      if (measure.kind === "height" && measure.positions[0]) {
        const top = measure.positions[0];
        items.push(lineFrom([[top[0], top[1], 0], top], color));
      }
      if (measure.kind === "distance" && measure.positions.length >= 2) {
        const a = measure.positions[0];
        const b = measure.positions[1];
        if (a && b) items.push(lineFrom([a, b], color));
      }
      if (measure.kind === "crosssection") {
        const ring = contourPoints(measure.contours);
        if (ring.length >= 2) items.push(lineFrom([...ring, ring[0]!], color));
      }
      if (measure.kind === "angle" && measure.positions.length >= 3) {
        const from = measure.positions[0];
        const at = measure.positions[1];
        const to = measure.positions[2];
        if (from && at && to) {
          const origin = vec(at);
          const a = vec(from).sub(origin);
          const b = vec(to).sub(origin);
          const radius = Math.min(a.length(), b.length()) * 0.35 || 0.04;
          const curve = new EllipseCurve(0, 0, radius, radius, 0, Math.PI / 3, false, 0);
          const pts = curve
            .getPoints(16)
            .map((p) => [p.x + at[0], p.y + at[1], at[2]] as const);
          items.push(lineFrom(pts, color));
        }
      }
    }
    return items;
  }, [measures, highlightId, palette]);

  return (
    <group>
      {markers.map((marker) => {
        const hot = highlightId === marker.path;
        const scale = hot ? 1.8 : 1;
        const color = palette[SOURCE_TOKENS[marker.source]];
        return (
          <mesh
            key={marker.path}
            position={marker.position}
            scale={scale}
            onPointerOver={() => onHover(marker.path)}
            onPointerOut={() => onHover(null)}
          >
            <sphereGeometry args={[0.012, 12, 12]} />
            <meshStandardMaterial
              color={color}
              roughness={0.4}
              metalness={0}
              emissive={hot ? color : NO_GLOW}
              emissiveIntensity={hot ? 0.4 : 0}
            />
          </mesh>
        );
      })}
      {lines.map((line, index) => (
        <primitive key={`line-${index}`} object={line} />
      ))}
    </group>
  );
};

/** The value as the panel lists it; the canvas label adds the height prefix. */
export const measureValueText = (measure: StoredMeasure): string => {
  const shown = presentMeasure(measure);
  return formatMetricValue({ key: "", value: shown.value, unit: shown.unit });
};

export const measureLabel = (measure: StoredMeasure): string => {
  const text = measureValueText(measure);
  return measure.kind === "height" ? `H=${text}` : text;
};

const measureAnchor = (
  measure: StoredMeasure,
): readonly [number, number, number] | null => {
  const anchor = measure.positions[0];
  if (!anchor) return null;
  const next = measure.positions[1];
  return next
    ? [(anchor[0] + next[0]) / 2, (anchor[1] + next[1]) / 2, (anchor[2] + next[2]) / 2]
    : anchor;
};

/**
 * Only the hovered or selected item gets a label; labelling every measurement
 * at once buried the body in numbers. A height can share its path with the
 * marker it stands on, so both read as one label at the marker.
 */
export const collectLabels = (
  markers: readonly StoredMarker[],
  measures: readonly StoredMeasure[],
  activeId: string | null,
): readonly OverlayLabel[] => {
  if (activeId === null) return [];
  const marker = markers.find((row) => row.path === activeId);
  const placed = measures
    .filter((row) => row.path === activeId)
    .flatMap((row) => {
      const anchor = measureAnchor(row);
      return anchor ? [{ text: measureLabel(row), anchor }] : [];
    });
  const position = marker?.position ?? placed[0]?.anchor;
  if (!position) return [];
  const text = [...(marker ? [marker.label] : []), ...placed.map((row) => row.text)];
  return [{ id: activeId, text: text.join(" · "), position }];
};

/** Projection runs every frame, so it only mounts when a label can show. */
export const shouldProjectLabels = (
  showLandmarks: boolean,
  labels: readonly OverlayLabel[],
): boolean => showLandmarks && labels.length > 0;

export const ProjectedLabels = ({
  labels,
  camera,
  onScreen,
}: {
  readonly labels: readonly OverlayLabel[];
  readonly camera: PerspectiveCamera;
  readonly onScreen: (
    rows: readonly { id: string; text: string; x: number; y: number }[],
  ) => void;
}) => {
  const size = useThree((state) => state.size);

  // Unmounting stops the frame loop, so clear the last label it drew.
  useEffect(() => () => onScreen([]), [onScreen]);

  const last = useRef("");
  useFrame(() => {
    const next = labels.map((label) => {
      const projected = new Vector3(...label.position).project(camera);
      return {
        id: label.id,
        text: label.text,
        x: (projected.x * 0.5 + 0.5) * size.width,
        y: (-projected.y * 0.5 + 0.5) * size.height,
      };
    });
    const key = next
      .map((row) => `${row.id}:${row.x.toFixed(0)}:${row.y.toFixed(0)}`)
      .join("|");
    if (key === last.current) return;
    last.current = key;
    onScreen(next);
  });
  return null;
};

export const parseSnapshotGeometry = (snapshot: {
  readonly markers?: unknown;
  readonly measures?: unknown;
}): {
  readonly markers: readonly StoredMarker[];
  readonly measures: readonly StoredMeasure[];
} => ({
  markers: asStoredMarkers(snapshot.markers),
  measures: asStoredMeasures(snapshot.measures),
});

export const groupedMarkerRows = (markers: readonly StoredMarker[]) => {
  const groups = [...MARKER_GROUPS, "other"] as const;
  return groups
    .map((group) => ({
      group,
      rows: markers.filter((row) => row.group === group),
    }))
    .filter((entry) => entry.rows.length > 0);
};

export const groupedMeasureRows = (measures: readonly StoredMeasure[]) => {
  const groups = [...MARKER_GROUPS, "other"] as const;
  return groups
    .map((group) => ({
      group,
      rows: measures.filter((row) => groupFromPath(row.path) === group),
    }))
    .filter((entry) => entry.rows.length > 0);
};
