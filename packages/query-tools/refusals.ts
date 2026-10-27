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
  | UnsupportedConversion;

const REFUSAL_CODES: readonly string[] = [
  SUBJECT_SCOPE_VIOLATION.code,
  ROW_CAP_EXCEEDED.code,
  "MIXED_UNITS",
  "NO_ROWS",
  "NO_PUBLISHED_RANGE",
  "UNIT_MISMATCH",
  "UNSUPPORTED_CONVERSION",
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
