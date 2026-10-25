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

export type ToolRefusal = SubjectScopeViolation | RowCapExceeded | MixedUnits;

const REFUSAL_CODES: readonly string[] = [
  SUBJECT_SCOPE_VIOLATION.code,
  ROW_CAP_EXCEEDED.code,
  "MIXED_UNITS",
];

export const isToolRefusal = (value: unknown): value is ToolRefusal =>
  typeof value === "object" &&
  value !== null &&
  "code" in value &&
  typeof value.code === "string" &&
  REFUSAL_CODES.includes(value.code);
