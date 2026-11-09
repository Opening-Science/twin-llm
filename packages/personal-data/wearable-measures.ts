import { isValidUcum } from "@open-twin/fhir-r4";

import type { EffectiveTime } from "./effective-time";
import type { ObservationDraft, Unmapped } from "./types";
import type { Measure } from "./wearable-measure-codes";

export { MEASURES, type Measure } from "./wearable-measure-codes";

export const measureObservation = (
  measure: Measure,
  value: number,
  time: EffectiveTime,
  sourceRef: string,
  note: string | null = null,
): ObservationDraft => ({
  codeSystem: measure.codeSystem,
  code: measure.code,
  display: measure.display,
  value,
  unit: measure.unit,
  unitUcum: isValidUcum(measure.unit),
  effectiveAt: time.at,
  effectivePrecision: time.precision,
  sourceRef,
  note,
});

/**
 * Records left out, counted by where, reason code and sentence. An export
 * can skip millions of samples; this keeps one entry per kind of skip.
 */
export type UnmappedTally = Readonly<{
  add: (where: string, code: string, reason: string) => void;
  list: () => readonly Unmapped[];
}>;

export const createUnmappedTally = (): UnmappedTally => {
  const entries = new Map<
    string,
    { where: string; code: string; reason: string; count: number }
  >();
  return {
    add: (where, code, reason) => {
      const key = `${where}\u0000${code}\u0000${reason}`;
      const known = entries.get(key);
      entries.set(key, { where, code, reason, count: (known?.count ?? 0) + 1 });
    },
    list: () => [...entries.values()],
  };
};

/** Whole minutes from seconds; exports give durations to the second. */
export const wholeMinutes = (seconds: number): number => Math.round(seconds / 60);
