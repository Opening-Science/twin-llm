import { MAX_CODES_LISTED, MAX_UNMAPPED_LISTED, PREVIEW_ROWS } from "./limits";
import type {
  ImportKind,
  ObservationDraft,
  ParsedOk,
  TableCell,
  TableColumn,
  Unmapped,
} from "./types";

/**
 * What Save would store, for the review step: counts, the date range, the
 * codes and units found, the rows that will not be stored and why, and the
 * first rows as they will be stored. Pure and JSON-safe, so the route can
 * send it as is. Values appear only in the preview, which goes to the person
 * who uploaded the file and nowhere else (never to the audit or a log).
 */

export type ReviewCode = Readonly<{
  system: string | null;
  code: string | null;
  display: string;
  units: readonly string[];
  count: number;
}>;

export type ReviewUnit = Readonly<{ unit: string; ucum: boolean; count: number }>;

export type ReviewReason = Readonly<{ code: string; example: string; count: number }>;

export type DateRange = Readonly<{ first: string; last: string }>;

export type ReviewSummary = Readonly<{
  kind: ImportKind;
  fileName: string;
  byteSize: number;
  sha256: string;
  rowsToStore: number;
  counts: Readonly<{
    observations: number;
    clinicalRecords: number;
    tableRows: number;
    tableColumns: number;
    unmapped: number;
  }>;
  dateRange: DateRange | null;
  codes: readonly ReviewCode[];
  codesTotal: number;
  units: readonly ReviewUnit[];
  columns: readonly TableColumn[];
  unmapped: Readonly<{ byReason: readonly ReviewReason[]; listed: readonly Unmapped[] }>;
  preview: Readonly<{
    columns: readonly string[];
    rows: readonly (readonly TableCell[])[];
  }>;
  notes: readonly string[];
}>;

export type FileFacts = Readonly<{ fileName: string; byteSize: number; sha256: string }>;

/** A stored date as the file gave it: `2024`, `2024-03`, `2024-03-01` or the full instant. */
export const effectiveText = (row: ObservationDraft): string => {
  const iso = row.effectiveAt.toISOString();
  switch (row.effectivePrecision) {
    case "year":
      return iso.slice(0, 4);
    case "month":
      return iso.slice(0, 7);
    case "day":
      return iso.slice(0, 10);
    case "instant":
      return iso;
  }
};

const extent = (values: readonly string[]): DateRange | null =>
  values.length === 0
    ? null
    : {
        first: values.reduce((a, b) => (b < a ? b : a)),
        last: values.reduce((a, b) => (b > a ? b : a)),
      };

/** Earliest and latest date in what would be stored, as ISO text. */
export const dateRangeOf = (parsed: ParsedOk): DateRange | null => {
  if (parsed.kind === "table") {
    const dateColumns = parsed.table.columns.flatMap((column, index) =>
      column.type === "date" ? [index] : [],
    );
    return extent(
      parsed.table.rows.flatMap((row) =>
        dateColumns.flatMap((index) => {
          const cell = row[index];
          return typeof cell === "string" ? [cell] : [];
        }),
      ),
    );
  }
  const clinical = parsed.kind === "fhir" ? parsed.clinical : [];
  return extent([
    ...parsed.observations.map((row) => row.effectiveAt.toISOString()),
    ...clinical.flatMap((row) =>
      [row.startAt, row.endAt].flatMap((date) =>
        date === null ? [] : [date.toISOString()],
      ),
    ),
  ]);
};

/**
 * Group rows by key, folding each into its group. The map is local and
 * filled in one pass: copying it per row would be quadratic on 200,000 rows.
 */
const groupBy = <T, G>(
  rows: readonly T[],
  keyOf: (row: T) => string,
  fold: (known: G | undefined, row: T) => G,
): readonly G[] => {
  const groups = new Map<string, G>();
  for (const row of rows) {
    const key = keyOf(row);
    groups.set(key, fold(groups.get(key), row));
  }
  return [...groups.values()];
};

const codesOf = (rows: readonly ObservationDraft[]): readonly ReviewCode[] =>
  groupBy<ObservationDraft, ReviewCode>(
    rows,
    (row) =>
      `${row.codeSystem ?? ""}|${row.code ?? ""}|${row.code === null ? row.display : ""}`,
    (known, row) => ({
      system: row.codeSystem,
      code: row.code,
      display: known?.display ?? row.display,
      units:
        known === undefined
          ? [row.unit]
          : known.units.includes(row.unit)
            ? known.units
            : [...known.units, row.unit],
      count: (known?.count ?? 0) + 1,
    }),
  ).toSorted((a, b) => b.count - a.count || a.display.localeCompare(b.display));

const unitsOf = (rows: readonly ObservationDraft[]): readonly ReviewUnit[] =>
  groupBy<ObservationDraft, ReviewUnit>(
    rows,
    (row) => row.unit,
    (known, row) => ({
      unit: row.unit,
      ucum: row.unitUcum,
      count: (known?.count ?? 0) + 1,
    }),
  ).toSorted((a, b) => b.count - a.count || a.unit.localeCompare(b.unit));

const reasonsOf = (unmapped: readonly Unmapped[]): readonly ReviewReason[] =>
  groupBy<Unmapped, ReviewReason>(
    unmapped,
    (row) => row.code,
    (known, row) => ({
      code: row.code,
      example: known?.example ?? row.reason,
      count: (known?.count ?? 0) + 1,
    }),
  ).toSorted((a, b) => b.count - a.count || a.code.localeCompare(b.code));

const OBSERVATION_PREVIEW_COLUMNS = ["date", "code", "name", "value", "unit"] as const;

const observationPreview = (rows: readonly ObservationDraft[]) =>
  rows
    .slice(0, PREVIEW_ROWS)
    .map((row): readonly TableCell[] => [
      effectiveText(row),
      row.code,
      row.display,
      row.value,
      row.unit,
    ]);

export const reviewSummary = (parsed: ParsedOk, file: FileFacts): ReviewSummary => {
  const observations = parsed.kind === "table" ? [] : parsed.observations;
  const clinicalRecords = parsed.kind === "fhir" ? parsed.clinical.length : 0;
  const tableRows = parsed.kind === "table" ? parsed.table.rows.length : 0;
  const codes = codesOf(observations);
  return {
    kind: parsed.kind,
    fileName: file.fileName,
    byteSize: file.byteSize,
    sha256: file.sha256,
    rowsToStore: observations.length + clinicalRecords + tableRows,
    counts: {
      observations: observations.length,
      clinicalRecords,
      tableRows,
      tableColumns: parsed.kind === "table" ? parsed.table.columns.length : 0,
      unmapped: parsed.unmapped.length,
    },
    dateRange: dateRangeOf(parsed),
    codes: codes.slice(0, MAX_CODES_LISTED),
    codesTotal: codes.length,
    units: unitsOf(observations),
    columns: parsed.kind === "table" ? parsed.table.columns : [],
    unmapped: {
      byReason: reasonsOf(parsed.unmapped),
      listed: parsed.unmapped.slice(0, MAX_UNMAPPED_LISTED),
    },
    preview:
      parsed.kind === "table"
        ? {
            columns: parsed.table.columns.map((column) => column.name),
            rows: parsed.table.rows.slice(0, PREVIEW_ROWS),
          }
        : {
            columns: OBSERVATION_PREVIEW_COLUMNS,
            rows: observationPreview(observations),
          },
    notes: parsed.notes,
  };
};
