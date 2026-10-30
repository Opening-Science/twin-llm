/**
 * Tables as CSV text (RFC 4180): commas, a quoted cell when it holds a comma,
 * a quote or a line break, CRLF between rows. A cell that starts with `=`,
 * `+`, `-`, `@`, a tab or a carriage return and is not a plain number gets a
 * leading `'`, so a spreadsheet shows it as text instead of running it (the
 * same rule as the evaluation review sheet). Missing values are empty cells,
 * never `0`. Pure.
 */

export type CsvCell = string | number | boolean | null | undefined;

const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?(e-?\d+)?$/i;

export const csvCell = (value: CsvCell): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  const text = String(value);
  const safe = FORMULA_START.test(text) && !PLAIN_NUMBER.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

export const toCsv = (
  header: readonly string[],
  rows: readonly (readonly CsvCell[])[],
): string =>
  [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
