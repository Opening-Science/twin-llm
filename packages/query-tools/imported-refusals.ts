import {
  IMPORTED_DATA_NOT_PERMITTED,
  type ImportedDataRefusalReason,
} from "@/infrastructure/data-mode-policy";

/**
 * Named refusals of the imported-data tools (#181). Like the warehouse
 * refusals each has a `code`, so the audit row counts 0 rows and the model can
 * say plainly why there is no answer. A series is named by `loinc` or `name`.
 */

export type ImportedSeriesRef = Readonly<{ loinc: string | null; name: string | null }>;

export type ImportedNotPermitted = Readonly<{
  code: typeof IMPORTED_DATA_NOT_PERMITTED;
  error: string;
  reason: ImportedDataRefusalReason;
}>;

const NOT_PERMITTED_ERRORS: Readonly<Record<ImportedDataRefusalReason, string>> = {
  "data-mode-not-personal": "imported data is read only in personal data mode",
  "chat-model-not-local":
    "imported data is read only by a model on this machine (Ollama on loopback), so nothing was read",
};

export const importedNotPermitted = (
  reason: ImportedDataRefusalReason,
): ImportedNotPermitted => ({
  code: IMPORTED_DATA_NOT_PERMITTED,
  error: NOT_PERMITTED_ERRORS[reason],
  reason,
});

export type DatasetNotFound = Readonly<{
  code: "DATASET_NOT_FOUND";
  error: string;
  dataset_id: string;
}>;

export const datasetNotFound = (datasetId: string): DatasetNotFound => ({
  code: "DATASET_NOT_FOUND",
  error: "no imported dataset of this person has this id; use imported_datasets",
  dataset_id: datasetId,
});

export type SeriesNotCombined = Readonly<{
  code: "SERIES_NOT_COMBINED";
  error: string;
  loinc: string;
  name: string;
}>;

/**
 * A LOINC code and a name stored with no code are different series: Oura and
 * Whoop HRV is RMSSD, stored by name, while `80404-7` is SDNN. They are never
 * read as one.
 */
export const seriesNotCombined = (loinc: string, name: string): SeriesNotCombined => ({
  code: "SERIES_NOT_COMBINED",
  error:
    "a LOINC series and a series stored by name do not mean the same measure, so they are not combined; ask for one",
  loinc,
  name,
});

export type ImportedNoRows = Readonly<{
  code: "NO_ROWS";
  error: string;
  loinc: readonly string[];
}>;

/** None of the asked codes has an imported reading; a mistyped code lands here too. */
export const importedNoRows = (codes: readonly string[]): ImportedNoRows => ({
  code: "NO_ROWS",
  error:
    "none of these LOINC codes has an imported reading; check imported_datasets for the codes and names stored before saying there is no data",
  loinc: [...codes],
});

export type ImportedMixedUnits = Readonly<{
  code: "MIXED_UNITS";
  error: string;
  series: ImportedSeriesRef;
  units: readonly string[];
}>;

export const importedMixedUnits = (
  series: ImportedSeriesRef,
  units: readonly string[],
): ImportedMixedUnits => ({
  code: "MIXED_UNITS",
  error: "the rows of this series use more than one unit as stored; nothing is converted",
  series,
  units: [...units].sort(),
});

export type PartialDates = Readonly<{
  code: "PARTIAL_DATES";
  error: string;
  series: ImportedSeriesRef;
  n_partial: number;
}>;

export const partialDates = (
  series: ImportedSeriesRef,
  nPartial: number,
): PartialDates => ({
  code: "PARTIAL_DATES",
  error:
    "some rows are dated only to a month or a year, so no slope per day is fitted; narrow the window to rows with full dates",
  series,
  n_partial: nPartial,
});

export type ImportedRefusal =
  | ImportedNotPermitted
  | DatasetNotFound
  | SeriesNotCombined
  | ImportedNoRows
  | ImportedMixedUnits
  | PartialDates;

export const IMPORTED_REFUSAL_CODES: readonly string[] = [
  IMPORTED_DATA_NOT_PERMITTED,
  "DATASET_NOT_FOUND",
  "SERIES_NOT_COMBINED",
  "PARTIAL_DATES",
];
