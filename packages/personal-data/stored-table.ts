import type { ColumnType, TableCell, TableColumn } from "./types";

/**
 * Reads back what `save` wrote for a research table: the column list
 * (`personal_tables.columns`) and the rows of a chunk
 * (`personal_table_chunks.rows`), both JSON. Pure, so a malformed value is
 * tested without a database; nothing malformed is passed on as a cell.
 */

const COLUMN_TYPES: readonly ColumnType[] = ["number", "date", "text"];

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toColumn = (item: unknown): TableColumn | null => {
  if (!isRecord(item) || typeof item.name !== "string") return null;
  const type = COLUMN_TYPES.find((each) => each === item.type);
  if (type === undefined) return null;
  return {
    name: item.name,
    type,
    missing: typeof item.missing === "number" ? item.missing : 0,
  };
};

/**
 * The stored column list (JSON written by `save`). One malformed entry makes
 * the whole list empty: dropping it would shift every later column onto the
 * wrong cells, and an empty list means every asked column is refused.
 */
export const storedColumns = (json: unknown): readonly TableColumn[] => {
  if (!Array.isArray(json)) return [];
  const columns = json.map(toColumn);
  return columns.every((column) => column !== null)
    ? columns.filter((column): column is TableColumn => column !== null)
    : [];
};

const toCell = (value: unknown): TableCell =>
  typeof value === "number" || typeof value === "string" ? value : null;

/** The stored rows of one chunk (a JSON array of arrays); a malformed row reads as empty. */
export const storedRows = (json: unknown): readonly (readonly TableCell[])[] =>
  Array.isArray(json)
    ? json.map((row: unknown) => (Array.isArray(row) ? row.map(toCell) : []))
    : [];
