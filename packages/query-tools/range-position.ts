/**
 * `range_position` without I/O: which Anchor v3 range a LOINC has and where a
 * reading sits against it. The range choice and the position are the Biomarkers
 * tab's own (`rangeChoice`, `placeValue` in packages/biomarkers/range-choice.ts),
 * so chat and the body twin never disagree.
 *
 * The warehouse keeps a synthetic subject's sex and birth year (#4), never a
 * full birth date and never any timing (fasting, time of day, cycle phase). So
 * the age at a reading is known only to within a year: the reading's UTC year
 * minus the birth year, or one less if the birthday had not come yet. A range
 * is chosen only when both ages give the same one; when they straddle an age
 * band, the range is reported as depending on age, never guessed. A fact that
 * is not stored stays in `depends_on` as before.
 */
import { type ReferenceInterval } from "@/packages/biomarkers/anchor-layer";
import { biomarkerByLoinc, referenceIntervalsOf } from "@/packages/biomarkers/catalogue";
import { parsePopulation, type Sex } from "@/packages/biomarkers/population";
import {
  missingFacts,
  placeValue,
  RANGE_FACTS,
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

/** Said with every age taken from the birth year, so nobody reads it as exact. */
export const AGE_NOTE =
  "approximate: only the birth year is stored, so the age at the reading is one of these two";

export type PublishedRange = Readonly<{
  low: number | null;
  high: number | null;
  unit: string;
  population: string;
  source: typeof RANGE_SOURCE;
}>;

/** The stored facts a sex- or age-specific range was chosen with; null for a range that needs none. */
export type FactsUsed = Readonly<{
  sex: Sex | null;
  /** The two possible ages at the reading, younger first, with `AGE_NOTE`. */
  age_years: readonly [number, number] | null;
  age_note: typeof AGE_NOTE | null;
}>;

export type RangePlacement = Readonly<{
  marker_id: string;
  range: PublishedRange | null;
  position: "below" | "within" | "above" | null;
  depends_on: readonly RangeFact[];
  facts_used: FactsUsed | null;
}>;

/** What the warehouse holds for the subject (`subjects.sex`, `subjects.birth_year`). */
export type SubjectRangeFacts = Readonly<{
  sex?: string | null;
  birthYear?: number | null;
}>;

type Reading = Readonly<{ value: number; unitUcum: string; effectiveAt?: Date }>;

type Chosen = Exclude<RangeChoice, Readonly<{ kind: "none" }>>;

type AnchorRange = Readonly<{ markerId: string; choice: Chosen }>;

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

const anchorSex = (sex: string | null | undefined): Sex | undefined =>
  sex === "female" || sex === "male" ? sex : undefined;

/**
 * The two ages a subject born in `birthYear` can have had at `at`: before and
 * after that year's birthday. Null when either is unknown or the reading is
 * from the birth year itself or before it.
 */
export const possibleAges = (
  birthYear: number | null | undefined,
  at: Date | undefined,
): readonly [number, number] | null => {
  if (birthYear == null || at === undefined || Number.isNaN(at.getTime())) return null;
  const older = at.getUTCFullYear() - birthYear;
  return older >= 1 ? [older - 1, older] : null;
};

const sameChoice = (a: RangeChoice, b: RangeChoice): boolean => {
  if (a.kind === "range" && b.kind === "range") return a.interval.id === b.interval.id;
  if (a.kind === "depends" && b.kind === "depends") return a.on.join() === b.on.join();
  return a.kind === b.kind;
};

type FactChoice = Readonly<{
  choice: RangeChoice;
  sex: Sex | undefined;
  ages: readonly [number, number] | null;
}>;

/**
 * The range for this subject at this reading. With a birth year, the range
 * must be the same at both possible ages; otherwise age is a missing fact.
 */
const chooseWithFacts = (
  markerId: string,
  facts: SubjectRangeFacts,
  at: Date | undefined,
): FactChoice => {
  const sex = anchorSex(facts.sex);
  const ages = possibleAges(facts.birthYear, at);
  if (ages === null) return { choice: rangeChoice(markerId, { sex }), sex, ages };
  const [younger, older] = ages.map((ageYears) =>
    rangeChoice(markerId, { sex, ageYears }),
  );
  if (younger && older && sameChoice(younger, older)) {
    return { choice: younger, sex, ages };
  }
  // The age band changes within the year the reading was taken in.
  const missing = missingFacts(referenceIntervalsOf(markerId), { sex });
  const on = RANGE_FACTS.filter((fact) => fact === "age" || missing.includes(fact));
  return { choice: { kind: "depends", on }, sex, ages: null };
};

const factsUsed = (
  interval: ReferenceInterval,
  sex: Sex | undefined,
  ages: readonly [number, number] | null,
): FactsUsed | null => {
  const population = parsePopulation(interval.population);
  const usesSex = population?.sex != null;
  const usesAge = population?.age != null;
  if (!usesSex && !usesAge) return null;
  return {
    sex: usesSex ? (sex ?? null) : null,
    age_years: usesAge ? ages : null,
    age_note: usesAge ? AGE_NOTE : null,
  };
};

/**
 * One reading against the code's published range for this subject, or why it
 * has no position. `facts` are the subject's stored sex and birth year; the
 * reading's `effectiveAt` dates the age.
 */
export const placeReading = (
  loinc: string,
  reading: Reading,
  facts: SubjectRangeFacts = {},
): RangePlacement | NoPublishedRange | UnitMismatch => {
  const found = anchorRange(loinc);
  if ("code" in found) return found;
  const { markerId } = found;
  const { choice, sex, ages } = chooseWithFacts(markerId, facts, reading.effectiveAt);
  if (choice.kind === "none") return noPublishedRange(loinc, "none-published");
  if (choice.kind === "depends") {
    if (choice.on.length === 0) return noPublishedRange(loinc, "not-chosen");
    return {
      marker_id: markerId,
      range: null,
      position: null,
      depends_on: choice.on,
      facts_used: null,
    };
  }
  const { interval } = choice;
  if (interval.blocked) return noPublishedRange(loinc, "flagged");
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
    facts_used: factsUsed(interval, sex, ages),
  };
};
