/**
 * Human presentation for BodyLoop measure lists.
 * Stored values stay metres / radians; this is the only conversion.
 * Idempotent: already-cm / already-deg rows pass through (chat wraps twice).
 * Never convert vitronic.property.* — body.height is already SI metres.
 */

import { roundTo } from "@/infrastructure/format-measure";
import type { VitronicMetric } from "@/infrastructure/vitronic-types";
import type { MeasureKind, StoredMeasure } from "./geometry";

export const UNIT_M = "m";
export const UNIT_RAD = "rad";
export const UNIT_CM = "cm";
export const UNIT_DEG = "deg";

const MEASURE_LIST_KEY = /^vitronic\.(height|distance|circumference|angle)\./;

const round1 = (value: number): number => roundTo(value, 1);

export const metresToDisplayCm = (metres: number): number => round1(metres * 100);

export const radiansToDisplayDeg = (radians: number): number =>
  round1((radians * 180) / Math.PI);

export type PresentedMeasure = Readonly<{
  value: number;
  unit: string;
}>;

const presentLength = (value: number, unit: string): PresentedMeasure => {
  if (unit === UNIT_M) return { value: metresToDisplayCm(value), unit: UNIT_CM };
  return { value, unit: unit || UNIT_CM };
};

const presentAngle = (value: number, unit: string): PresentedMeasure => {
  if (unit === UNIT_RAD) return { value: radiansToDisplayDeg(value), unit: UNIT_DEG };
  return { value, unit: unit || UNIT_DEG };
};

export const presentMeasure = (
  measure: Pick<StoredMeasure, "kind" | "value" | "unit">,
): PresentedMeasure => {
  if (measure.kind === "angle") return presentAngle(measure.value, measure.unit);
  return presentLength(measure.value, measure.unit);
};

const listKindFromKey = (key: string): MeasureKind | null => {
  if (key.startsWith("vitronic.height.")) return "height";
  if (key.startsWith("vitronic.distance.")) return "distance";
  if (key.startsWith("vitronic.circumference.")) return "crosssection";
  if (key.startsWith("vitronic.angle.")) return "angle";
  return null;
};

export const presentSummaryMetric = (metric: VitronicMetric): VitronicMetric => {
  if (typeof metric.value !== "number" || !Number.isFinite(metric.value)) return metric;
  if (!MEASURE_LIST_KEY.test(metric.key)) return metric;
  const kind = listKindFromKey(metric.key);
  if (!kind) return metric;
  const unit = typeof metric.unit === "string" ? metric.unit : "";
  const presented = presentMeasure({ kind, value: metric.value, unit });
  return { ...metric, value: presented.value, unit: presented.unit };
};
