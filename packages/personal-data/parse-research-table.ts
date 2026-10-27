import { detectDelimiter, parseDelimited } from "./delimited";
import { MAX_COLUMNS, MAX_ROWS } from "./limits";
import type { ColumnType, ParsedImport, TableCell, TableColumn, Unmapped } from "./types";

/**
 * Any research table as CSV or TSV: a header row of unique names, then rows.
 *
 * Each column gets one type from its non-missing cells: `number` when every
 * one is a plain number, `date` when every one is a calendar day
 * (`2024-03-01`), otherwise `text`. Values are kept as written within that
 * type: numbers as numbers, days as `YYYY-MM-DD` text, text as is. A missing
 * cell (empty, `NA`, `N/A`, `NaN`, `null`) is stored as null, never `0`.
 * A row whose field count differs from the header is reported, not padded.
 * Over 200 columns or 200,000 rows the file is refused, not cut.
 */

const NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
export const MISSING_MARKERS: ReadonlySet<string> = new Set([
  "",
  "na",
  "n/a",
  "nan",
  "null",
]);

const isMissing = (cell: string): boolean =>
  MISSING_MARKERS.has(cell.trim().toLowerCase());

const isDay = (cell: string): boolean => {
  const match = DAY.exec(cell);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

const inferType = (cells: readonly string[]): ColumnType => {
  const present = cells.filter((cell) => !isMissing(cell));
  if (present.length === 0) return "text";
  if (present.every((cell) => NUMBER.test(cell))) return "number";
  if (present.every(isDay)) return "date";
  return "text";
};

const toCell = (raw: string, type: ColumnType): TableCell => {
  const cell = raw.trim();
  if (isMissing(cell)) return null;
  return type === "number" ? Number(cell) : cell;
};

const refuse = (code: string, message: string): ParsedImport => ({
  ok: false,
  refusal: { code, message },
});

export const parseResearchTable = (text: string): ParsedImport => {
  const parsed = parseDelimited(text, detectDelimiter(text));
  if (!parsed.ok) {
    return refuse(
      "unclosed-quote",
      `A quoted field that starts on line ${parsed.line} is never closed.`,
    );
  }
  const [header, ...rows] = parsed.rows;
  if (header === undefined || rows.length === 0) {
    return refuse("empty", "The file has no rows under its header.");
  }
  const names = header.map((name) => name.trim());
  if (names.length > MAX_COLUMNS) {
    return refuse(
      "too-many-columns",
      `The table has ${names.length} columns; the limit is ${MAX_COLUMNS}.`,
    );
  }
  if (rows.length > MAX_ROWS) {
    return refuse(
      "too-many-rows",
      `The table has ${rows.length} rows; the limit is ${MAX_ROWS}.`,
    );
  }
  const blank = names.findIndex((name) => name === "");
  if (blank !== -1) {
    return refuse("blank-column-name", `Column ${blank + 1} has no name in the header.`);
  }
  const duplicate = names.find((name, index) => names.indexOf(name) !== index);
  if (duplicate !== undefined) {
    return refuse(
      "duplicate-column-name",
      `Column names must be unique; "${duplicate}" appears more than once.`,
    );
  }

  const unmapped: readonly Unmapped[] = rows.flatMap((row, index) =>
    row.length === names.length
      ? []
      : [
          {
            where: `row ${index + 2}`,
            code: "field-count",
            reason: `has ${row.length} fields; the header has ${names.length}`,
          },
        ],
  );
  const kept = rows.filter((row) => row.length === names.length);
  if (kept.length === 0) {
    return refuse(
      "no-matching-rows",
      "No row has as many fields as the header. Check the separator (comma or tab).",
    );
  }

  const types = names.map((_, column) => inferType(kept.map((row) => row[column]!)));
  const columns: TableColumn[] = names.map((name, column) => ({
    name,
    type: types[column]!,
    missing: kept.filter((row) => isMissing(row[column]!)).length,
  }));
  const tableRows = kept.map((row) =>
    row.map((cell, column) => toCell(cell, types[column]!)),
  );
  return {
    ok: true,
    kind: "table",
    table: { columns, rows: tableRows },
    unmapped,
    notes: [],
  };
};
