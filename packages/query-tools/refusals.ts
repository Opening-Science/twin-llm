import { GBD_REFUSAL_CODES, type GbdRefusal } from "./gbd-refusals";
import { IMPORTED_REFUSAL_CODES, type ImportedRefusal } from "./imported-refusals";
import { SUBJECT_SCOPE_VIOLATION, type SubjectScopeViolation } from "./scope";

/**
 * Named refusals a query tool returns instead of a number it cannot stand
 * behind. Each has a `code`, so the audit records row_count 0 for it (a refusal
 * never counts as data) and the model can say plainly why there is no answer.
 */

/** Rows one analytics query may read. More is refused, not truncated: a fit on cut-off rows is wrong. */
export const ANALYTICS_ROW_CAP = 5000;

export const ROW_CAP_EXCEEDED = {
  code: "ROW_CAP_EXCEEDED",
  error: "more than 5000 observations in this window; narrow the window",
} as const;

export type RowCapExceeded = Readonly<{ code: "ROW_CAP_EXCEEDED"; error: string }>;

/** The timeline tools' cap: they list records, not observations. */
export const recordCapExceeded = (cap: number): RowCapExceeded => ({
  code: "ROW_CAP_EXCEEDED",
  error: `more than ${cap} records in this window; narrow the window`,
});

export type MixedUnits = Readonly<{
  code: "MIXED_UNITS";
  error: string;
  loinc: string;
  units: readonly string[];
}>;

/** There is no unit conversion, so rows in two units are never averaged together. */
export const mixedUnits = (loinc: string, units: readonly string[]): MixedUnits => ({
  code: "MIXED_UNITS",
  error: "observations for this code use more than one unit",
  loinc,
  units: [...units].sort(),
});

export type UnsupportedConversion = Readonly<{
  code: "UNSUPPORTED_CONVERSION";
  error: string;
  analyte: string;
  from: string;
  to: string;
  /** The pairs the table does hold for this analyte, "from → to". */
  supported: readonly string[];
}>;

/** `convert_unit` converts only the pairs in its table; any other pair is refused, never guessed. */
export const unsupportedConversion = (
  analyte: string,
  from: string,
  to: string,
  supported: readonly string[],
): UnsupportedConversion => ({
  code: "UNSUPPORTED_CONVERSION",
  error:
    from === to
      ? "from and to are the same unit; there is nothing to convert"
      : "the conversion table has no factor for this analyte between these units",
  analyte,
  from,
  to,
  supported: [...supported],
});

export type ToolRefusal =
  | SubjectScopeViolation
  | RowCapExceeded
  | MixedUnits
  | NoRows
  | NoRecords
  | NoPublishedRange
  | UnitMismatch
  | UnsupportedConversion
  | CohortRowCapExceeded
  | CohortTooSmall
  | SourceNotConnected
  | NoWearableRows
  | WearableMixedUnits
  | WindowTooShort
  | SourcesUnitMismatch
  | NoRhythmData
  | OutsideSubjectWindow
  | CohortNotSupported
  | DesignNotSupported
  | CohortRecordCapExceeded
  | ImportedRefusal
  | GbdRefusal;

const REFUSAL_CODES: readonly string[] = [
  SUBJECT_SCOPE_VIOLATION.code,
  ROW_CAP_EXCEEDED.code,
  "MIXED_UNITS",
  "NO_ROWS",
  "NO_PUBLISHED_RANGE",
  "UNIT_MISMATCH",
  "UNSUPPORTED_CONVERSION",
  "COHORT_ROW_CAP_EXCEEDED",
  "COHORT_TOO_SMALL",
  "SOURCE_NOT_CONNECTED",
  "WINDOW_TOO_SHORT",
  "NO_RHYTHM_DATA",
  "OUTSIDE_SUBJECT_WINDOW",
  "COHORT_NOT_SUPPORTED",
  "DESIGN_NOT_SUPPORTED",
  "COHORT_RECORD_CAP_EXCEEDED",
  ...IMPORTED_REFUSAL_CODES,
  ...GBD_REFUSAL_CODES,
];

export const isToolRefusal = (value: unknown): value is ToolRefusal =>
  typeof value === "object" &&
  value !== null &&
  "code" in value &&
  typeof value.code === "string" &&
  REFUSAL_CODES.includes(value.code);

export type NoRows = Readonly<{ code: "NO_ROWS"; error: string; loinc: string }>;

/** No reading to report: none for this code in the window, or none at the requested time. */
export const noRows = (loinc: string, at: string | null): NoRows => ({
  code: "NO_ROWS",
  error:
    at === null
      ? "no observation for this code in this window"
      : "no observation for this code at this effective_at in this window",
  loinc,
});

export type NoReadingForCodes = Readonly<{
  code: "NO_ROWS";
  error: string;
  loinc: readonly string[];
}>;

/**
 * None of the asked codes has a reading for the subject. A mistyped code
 * (88678-4 for heart rate, 8867-4) lands here too, so the error says to check
 * the code before telling anyone there is no data.
 */
export const noReadingForCodes = (codes: readonly string[]): NoReadingForCodes => ({
  code: "NO_ROWS",
  error:
    "none of these LOINC codes has a reading for this subject; check each code is the one meant before saying there is no data",
  loinc: [...codes],
});

export type ClinicalRecordKind = "condition" | "medication request";

export type NoRecords = Readonly<{
  code: "NO_ROWS";
  error: string;
  record: ClinicalRecordKind;
}>;

/**
 * No record to list: says which kind, which window rule and which filters, so
 * the answer can say plainly what is missing. It never says the subject has
 * none at all, only none that match.
 */
export const noRecords = (
  record: ClinicalRecordKind,
  filters: Readonly<{ status?: string; code?: string }>,
): NoRecords => {
  const status = record === "condition" ? "clinical status" : "status";
  const matching = [
    filters.code === undefined ? null : `code ${filters.code}`,
    filters.status === undefined ? null : `${status} ${filters.status}`,
  ].filter((part) => part !== null);
  const which = matching.length === 0 ? "" : ` with ${matching.join(" and ")}`;
  return {
    code: "NO_ROWS",
    error:
      record === "condition"
        ? `no condition${which} is recorded for this subject with a span (onset to abatement, or still open) that overlaps this window`
        : `no medication request${which} is recorded for this subject as authored in this window`,
    record,
  };
};

export type NoPublishedRange = Readonly<{
  code: "NO_PUBLISHED_RANGE";
  error: string;
  loinc: string;
}>;

const NO_RANGE_REASONS = {
  "not-anchor": "this code is not an Anchor v3 biomarker, so there is no published range",
  "none-published": "Anchor v3 publishes no reference range for this biomarker",
  flagged:
    "Anchor v3 flags this biomarker's unit (open-twin D11), so its range gives no position",
  "not-chosen": "no single Anchor v3 range applies, and none is guessed",
  "no-position": "the Anchor v3 range gives no position for this value",
} as const;

export type NoRangeReason = keyof typeof NO_RANGE_REASONS;

export const noPublishedRange = (
  loinc: string,
  reason: NoRangeReason,
): NoPublishedRange => ({
  code: "NO_PUBLISHED_RANGE",
  error: NO_RANGE_REASONS[reason],
  loinc,
});

export type UnitMismatch = Readonly<{
  code: "UNIT_MISMATCH";
  error: string;
  loinc: string;
  unit: string;
  range_unit: string;
}>;

/** range_position never converts, so a value in another unit gets no position; `convert_unit` may convert it first. */
export const unitMismatch = (
  loinc: string,
  unit: string,
  rangeUnit: string,
): UnitMismatch => ({
  code: "UNIT_MISMATCH",
  error:
    "the observation's unit is not the published range's unit; nothing is converted here. convert_unit converts the value when its table holds this analyte and pair.",
  loinc,
  unit,
  range_unit: rangeUnit,
});

/**
 * Rows one cohort-wide read may hold: every subject's rows of one code in the
 * window. More is refused, not truncated, because a truncated read would drop
 * whole people from the comparison.
 */
export const COHORT_ROW_CAP = 20_000;

export const COHORT_ROW_CAP_EXCEEDED = {
  code: "COHORT_ROW_CAP_EXCEEDED",
  error:
    "more than 20000 observations for this code across the cohort in this window; narrow the window",
} as const;

export type CohortRowCapExceeded = typeof COHORT_ROW_CAP_EXCEEDED;

/** With fewer people with a value than this, no percentile is given. */
export const COHORT_MINIMUM = 10;

export type CohortTooSmall = Readonly<{
  code: "COHORT_TOO_SMALL";
  error: string;
  loinc: string;
  n: number;
  minimum: typeof COHORT_MINIMUM;
}>;

/** A percentile among a handful of people says little and points at each of them. */
export const cohortTooSmall = (loinc: string, n: number): CohortTooSmall => ({
  code: "COHORT_TOO_SMALL",
  error: "fewer than 10 people in this cohort have a value for this code in this window",
  loinc,
  n,
  minimum: COHORT_MINIMUM,
});

/** Readings a wearable trend needs from at least one source. */
export const WEARABLE_TREND_MINIMUM = 7;

export type SourceNotConnected = Readonly<{
  code: "SOURCE_NOT_CONNECTED";
  error: string;
  source: string;
  /** What this turn can read: linked wearables, or `synthetic` for a synthetic subject. */
  available: readonly string[];
}>;

/**
 * The wearable tools read a source only when this turn has it: a linked
 * snapshot in personal mode, the synthetic series in synthetic mode.
 */
export const sourceNotConnected = (
  source: string,
  available: readonly string[],
): SourceNotConnected => ({
  code: "SOURCE_NOT_CONNECTED",
  error: available.includes("synthetic")
    ? "a synthetic subject has one synthetic series, read with source all; no wearable vendor is linked to it"
    : source === "all"
      ? "no wearable is linked for this turn"
      : "this wearable is not linked for this turn",
  source,
  available: [...available],
});

export type NoWearableRows = Readonly<{
  code: "NO_ROWS";
  error: string;
  measure: string;
  source: string;
}>;

/** No reading of this measure from the requested sources in the window. */
export const noWearableRows = (measure: string, source: string): NoWearableRows => ({
  code: "NO_ROWS",
  error: "no reading of this measure from this source in this window",
  measure,
  source,
});

export type WearableMixedUnits = Readonly<{
  code: "MIXED_UNITS";
  error: string;
  measure: string;
  source: string;
  units: readonly string[];
}>;

/**
 * One source's readings of one field in more than one unit, or in a unit
 * other than the one the field is named for (`duration_min`). Nothing is
 * converted.
 */
export const wearableMixedUnits = (
  measure: string,
  source: string,
  units: readonly string[],
): WearableMixedUnits => ({
  code: "MIXED_UNITS",
  error:
    "this source's readings of this measure are not all in the one unit the tool reports",
  measure,
  source,
  units: [...units].sort(),
});

export type WindowTooShort = Readonly<{
  code: "WINDOW_TOO_SHORT";
  error: string;
  measure: string;
  minimum: number;
  counts: ReadonlyArray<Readonly<{ source: string; n: number }>>;
}>;

/** Some readings, but no source has enough for a trend. */
export const windowTooShort = (
  measure: string,
  counts: ReadonlyArray<Readonly<{ source: string; n: number }>>,
): WindowTooShort => ({
  code: "WINDOW_TOO_SHORT",
  error: `fewer than ${WEARABLE_TREND_MINIMUM} daily readings from every source in this window; too few for a trend`,
  measure,
  minimum: WEARABLE_TREND_MINIMUM,
  counts: counts.map((count) => ({ source: count.source, n: count.n })),
});

/** Two days both sources recorded is not enough to say how far apart they read. */
export const tooFewPairedDays = (
  measure: string,
  minimum: number,
  pairs: number,
): WindowTooShort => ({
  code: "WINDOW_TOO_SHORT",
  error: `fewer than ${minimum} days that both sources recorded in this window; too few to compare them`,
  measure,
  minimum,
  counts: [{ source: "both", n: pairs }],
});

export type SourcesUnitMismatch = Readonly<{
  code: "UNIT_MISMATCH";
  error: string;
  measure: string;
  units: ReadonlyArray<Readonly<{ source: string; unit: string | null }>>;
}>;

/** The two sources record the measure in different units; nothing is converted. */
export const sourcesUnitMismatch = (
  measure: string,
  units: ReadonlyArray<Readonly<{ source: string; unit: string | null }>>,
): SourcesUnitMismatch => ({
  code: "UNIT_MISMATCH",
  error: "the two sources record this measure in different units; nothing is converted",
  measure,
  units: units.map((each) => ({ source: each.source, unit: each.unit })),
});

/** No dated record of this code for the subject, so there is no event to look around. */
export const noEvent = (record: ClinicalRecordKind, code: string): NoRecords => ({
  code: "NO_ROWS",
  error: `no ${record} with code ${code} and a recorded date is on file for this subject`,
  record,
});

export type NoRhythmData = Readonly<{ code: "NO_RHYTHM_DATA"; error: string }>;

/**
 * No beat-level recording exists outside the rhythm simulator: wearable
 * summaries hold daily values only, so personal mode has nothing to describe.
 */
export const NO_RHYTHM_DATA: NoRhythmData = {
  code: "NO_RHYTHM_DATA",
  error:
    "no beat-level recordings exist for this turn; rhythm_irregularity describes simulated recordings of synthetic subjects only",
};

/** A simulated recording with fewer intervals than one analysis window. */
export const tooFewBeats = (minimum: number, n: number): WindowTooShort => ({
  code: "WINDOW_TOO_SHORT",
  error: `fewer than ${minimum} RR intervals in this recording; too few for one window`,
  measure: "rr_intervals",
  minimum,
  counts: [{ source: "simulated", n }],
});

export type OutsideSubjectWindow = Readonly<{
  code: "OUTSIDE_SUBJECT_WINDOW";
  error: string;
  date: string | null;
  window: Readonly<{ start: string | null; end: string | null }>;
}>;

/** A recording day must fall within the days the subject has observations. */
export const outsideSubjectWindow = (
  date: string | null,
  window: Readonly<{ start: string | null; end: string | null }>,
): OutsideSubjectWindow => ({
  code: "OUTSIDE_SUBJECT_WINDOW",
  error:
    window.start === null
      ? "this subject has no observations, so there is no day to simulate a recording on"
      : "date is outside the days this subject has observations; pick a day within window",
  date,
  window: { start: window.start, end: window.end },
});

export type CohortNotSupported = Readonly<{
  code: "COHORT_NOT_SUPPORTED";
  error: string;
  cohort_id: string;
  /** Loaded cohorts `cohort_event_rates` can read. */
  cohorts: readonly string[];
}>;

/**
 * `cohort_event_rates` needs a cohort's end date and history window, which
 * are known only for the 1M batches and their AF subset.
 */
export const cohortNotSupported = (
  cohortId: string,
  cohorts: readonly string[],
): CohortNotSupported => ({
  code: "COHORT_NOT_SUPPORTED",
  error:
    "cohort_event_rates knows the follow-up window of the 1M Synthea batches and their AF subset only; use one listed in cohorts",
  cohort_id: cohortId,
  cohorts: [...cohorts],
});

export type DesignNotSupported = Readonly<{
  code: "DESIGN_NOT_SUPPORTED";
  error: string;
  cohort_id: string;
  /** The condition code the cohort was selected on. */
  selected_on: string;
}>;

/**
 * A cohort made of the people with one condition has nobody without it, so
 * only the within-person design with that condition as the exposure can be
 * computed on it.
 */
export const designNotSupported = (
  cohortId: string,
  selectedOn: string,
): DesignNotSupported => ({
  code: "DESIGN_NOT_SUPPORTED",
  error: `this cohort holds only people with condition ${selectedOn}, so it supports the within design with ${selectedOn} as the exposure only`,
  cohort_id: cohortId,
  selected_on: selectedOn,
});

/** People or condition records one `cohort_event_rates` read may hold. */
export const COHORT_RECORD_CAP = 50_000;

export type CohortRecordCapExceeded = Readonly<{
  code: "COHORT_RECORD_CAP_EXCEEDED";
  error: string;
  record: "subject" | "condition";
  cap: typeof COHORT_RECORD_CAP;
}>;

/** More is refused, not truncated: a cut read would drop people or events. */
export const cohortRecordCapExceeded = (
  record: "subject" | "condition",
): CohortRecordCapExceeded => ({
  code: "COHORT_RECORD_CAP_EXCEEDED",
  error: `more than ${COHORT_RECORD_CAP} ${record} records in this cohort for this question`,
  record,
  cap: COHORT_RECORD_CAP,
});
