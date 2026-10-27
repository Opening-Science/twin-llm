/**
 * `range_position` without I/O: which Anchor v3 range a LOINC has and where a
 * reading sits against it. The range choice and the position are the Biomarkers
 * tab's own (`rangeChoice`, `placeValue` in packages/biomarkers/range-choice.ts),
 * so chat and the body twin never disagree.
 *
 * The warehouse holds no sex, age or timing for a subject (issue #4), so the
 * context is always empty: a range that needs one of them is reported as
 * depending on it, never guessed.
 */
import { biomarkerByLoinc } from "@/packages/biomarkers/catalogue";
import {
  placeValue,
  rangeChoice,
  type RangeChoice,
  type RangeFact,
} from "@/packages/biomarkers/range-choice";

import {
  noPublishedRange,
  type NoPublishedRange,
  unitMismatch,
  type UnitMismatch,
} from "./refusals";

export const RANGE_SOURCE = "Anchor v3";

export type PublishedRange = Readonly<{
  low: number | null;
  high: number | null;
  unit: string;
  population: string;
  source: typeof RANGE_SOURCE;
}>;

export type RangePlacement = Readonly<{
  marker_id: string;
  range: PublishedRange | null;
  position: "below" | "within" | "above" | null;
  depends_on: readonly RangeFact[];
}>;

type AnchorRange = Readonly<{
  markerId: string;
  choice: Exclude<RangeChoice, Readonly<{ kind: "none" }>>;
}>;

const anchorRange = (loinc: string): AnchorRange | NoPublishedRange => {
  const marker = biomarkerByLoinc(loinc);
  if (!marker) return noPublishedRange(loinc, "not-anchor");
  const choice = rangeChoice(marker.id);
  if (choice.kind === "none") return noPublishedRange(loinc, "none-published");
  if (choice.kind === "range" && choice.interval.blocked) {
    return noPublishedRange(loinc, "flagged");
  }
  if (choice.kind === "depends" && choice.on.length === 0) {
    return noPublishedRange(loinc, "not-chosen");
  }
  return { markerId: marker.id, choice };
};

/**
 * Refusals known from the code alone, before any row is read: not an Anchor
 * marker, no range published, a range Anchor flags (D11), or no single range
 * for a reason other than a missing fact. Null when there is a range or it
 * depends on sex, age or timing.
 */
export const rangeRefusalFor = (loinc: string): NoPublishedRange | null => {
  const found = anchorRange(loinc);
  return "code" in found ? found : null;
};

/** One reading against the code's published range, or why it has no position. */
export const placeReading = (
  loinc: string,
  reading: Readonly<{ value: number; unitUcum: string }>,
): RangePlacement | NoPublishedRange | UnitMismatch => {
  const found = anchorRange(loinc);
  if ("code" in found) return found;
  const { markerId, choice } = found;
  if (choice.kind === "depends") {
    return { marker_id: markerId, range: null, position: null, depends_on: choice.on };
  }
  const { interval } = choice;
  const placement = placeValue(reading.value, reading.unitUcum, interval);
  if (placement.kind === "unit-mismatch") {
    return unitMismatch(loinc, placement.unit, placement.rangeUnit);
  }
  if (placement.kind === "none") return noPublishedRange(loinc, "no-position");
  return {
    marker_id: markerId,
    range: {
      low: interval.low,
      high: interval.high,
      unit: reading.unitUcum,
      population: interval.population,
      source: RANGE_SOURCE,
    },
    position: placement.position,
    depends_on: [],
  };
};
