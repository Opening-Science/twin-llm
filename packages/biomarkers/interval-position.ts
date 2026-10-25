/**
 * Where a value sits against a published reference interval: below, within or
 * above. It is a neutral position, not a judgement, and the UI words it that way.
 *
 * `unknown` whenever the comparison would not be honest:
 * - no interval, or both bounds missing;
 * - the marker is BLOCKING in Anchor (LOINC property vs unit, open-twin D11);
 * - the value's unit is not the interval's UCUM code, compared exactly. UCUM is
 *   case-sensitive (`mg/dL` is not `mg/dl`), and nothing here converts units;
 * - the value is not a finite number.
 *
 * Bounds are inclusive, and a missing bound is open (`CRP < 5`, `HDL ≥ 40`).
 */
import { type ReferenceInterval } from "./anchor-layer";

export type IntervalPosition = "below" | "within" | "above" | "unknown";

export const intervalPosition = (
  value: number,
  unit: string,
  interval: ReferenceInterval | null,
): IntervalPosition => {
  if (!interval || interval.blocked) return "unknown";
  if (interval.unitUcum === null || unit !== interval.unitUcum) return "unknown";
  if (!Number.isFinite(value)) return "unknown";
  if (interval.low === null && interval.high === null) return "unknown";
  if (interval.low !== null && value < interval.low) return "below";
  if (interval.high !== null && value > interval.high) return "above";
  return "within";
};
