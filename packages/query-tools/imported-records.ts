import type { ColumnType, TableCell, TableColumn } from "@/packages/personal-data/types";

import type {
  ImportedConditionRecord,
  ImportedMedicationRecord,
  ImportedTableRecord,
} from "./imported-ports";

/**
 * Pure helpers behind `imported_table`, `imported_conditions` (#181) and
 * `imported_medications` (#299). No I/O, so the tests check them with made-up
 * rows. A table is read by column names matched whole against the stored list;
 * a Condition or a MedicationRequest is read as coded fields and dates only.
 */

/** Characters kept from one text cell; a longer cell is cut and counted. */
export const IMPORTED_TEXT_CELL_CAP = 200;

export type ImportedColumnEntry = Readonly<{ name: string; type: ColumnType }>;

/** Asked names not in the stored list, in the order asked. */
export const missingColumns = (
  stored: readonly TableColumn[],
  asked: readonly string[],
): readonly string[] => {
  const names = new Set(stored.map((column) => column.name));
  return asked.filter((name) => !names.has(name));
};

/** A text cell over the cap is cut to it; numbers, dates as numbers and nulls pass. */
export const cutCell = (
  cell: TableCell,
  cap: number = IMPORTED_TEXT_CELL_CAP,
): Readonly<{ cell: TableCell; cut: boolean }> =>
  typeof cell === "string" && cell.length > cap
    ? { cell: cell.slice(0, cap), cut: true }
    : { cell, cut: false };

export type SelectedColumns = Readonly<{
  columns: readonly ImportedColumnEntry[];
  rows: readonly (readonly TableCell[])[];
  cellsCut: number;
}>;

/**
 * The asked columns of each row, in the order asked. Every asked name must be
 * stored (`missingColumns` first). A row shorter than the column list reads
 * the absent cells as null.
 */
export const selectColumns = (
  stored: readonly TableColumn[],
  rows: readonly (readonly TableCell[])[],
  asked: readonly string[],
): SelectedColumns => {
  const picked = asked.flatMap((name) => {
    const index = stored.findIndex((column) => column.name === name);
    const column = stored[index];
    return column === undefined ? [] : [{ index, column }];
  });
  const cut = rows.map((row) => picked.map(({ index }) => cutCell(row[index] ?? null)));
  return {
    columns: picked.map(({ column }) => ({ name: column.name, type: column.type })),
    rows: cut.map((row) => row.map((each) => each.cell)),
    cellsCut: cut.reduce(
      (total, row) => total + row.filter((each) => each.cut).length,
      0,
    ),
  };
};

/** Each table dataset's column names and types, for the listing. */
export const tableColumnsById = (
  tables: readonly ImportedTableRecord[],
): ReadonlyMap<string, readonly ImportedColumnEntry[]> =>
  new Map(
    tables.map((table) => [
      table.datasetId,
      table.columns.map((column) => ({ name: column.name, type: column.type })),
    ]),
  );

export type ImportedConditionEntry = Readonly<{
  code_system: string | null;
  code: string | null;
  display: string;
  onset: string | null;
  abatement: string | null;
  status: string | null;
}>;

/** A stored Condition as the tool returns it: coded fields and dates, nothing else. */
export const conditionEntry = (
  record: ImportedConditionRecord,
): ImportedConditionEntry => ({
  code_system: record.codeSystem,
  code: record.code,
  display: record.display,
  onset: record.onsetAt === null ? null : record.onsetAt.toISOString(),
  abatement: record.abatementAt === null ? null : record.abatementAt.toISOString(),
  status: record.status,
});

export type ImportedMedicationEntry = Readonly<{
  code_system: string | null;
  code: string | null;
  display: string;
  authored: string | null;
  status: string | null;
}>;

/** A stored MedicationRequest as the tool returns it: coded fields, the authored date and status. */
export const medicationEntry = (
  record: ImportedMedicationRecord,
): ImportedMedicationEntry => ({
  code_system: record.codeSystem,
  code: record.code,
  display: record.display,
  authored: record.authoredAt === null ? null : record.authoredAt.toISOString(),
  status: record.status,
});
