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

export type RowCapExceeded = typeof ROW_CAP_EXCEEDED;

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

export type ToolRefusal =
  | SubjectScopeViolation
  | RowCapExceeded
  | MixedUnits
  | NoRows
  | NoPublishedRange
  | UnitMismatch;

const REFUSAL_CODES: readonly string[] = [
  SUBJECT_SCOPE_VIOLATION.code,
  ROW_CAP_EXCEEDED.code,
  "MIXED_UNITS",
  "NO_ROWS",
  "NO_PUBLISHED_RANGE",
  "UNIT_MISMATCH",
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

/** There is no unit conversion, so a value in another unit gets no position. */
export const unitMismatch = (
  loinc: string,
  unit: string,
  rangeUnit: string,
): UnitMismatch => ({
  code: "UNIT_MISMATCH",
  error: "the observation's unit is not the published range's unit; nothing is converted",
  loinc,
  unit,
  range_unit: rangeUnit,
});
