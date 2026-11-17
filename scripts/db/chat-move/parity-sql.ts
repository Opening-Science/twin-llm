import { sourceValues, type TableMove, targetColumns } from "./tables";

/**
 * Read-only SQL comparing an old chat table with its copy
 * (DATA-MODEL.md C.3). Pure: SQL text only.
 */

/**
 * Rows on one side only, after mapping the old row: an old row with no
 * equal copy (missing, or any column different) and a copy with no equal old
 * row (left behind, or changed). Text compares byte for byte, numbers
 * exactly, times as instants. Returns `old_only` and `new_only` counts.
 */
export const differencesSql = (move: TableMove): string => `WITH mapped AS (
  SELECT ${sourceValues(move, "o")} FROM "${move.from}" o
), copied AS (
  SELECT ${targetColumns(move)} FROM "${move.to}"
)
SELECT (SELECT count(*) FROM (SELECT * FROM mapped EXCEPT ALL SELECT * FROM copied) d)::int AS old_only,
       (SELECT count(*) FROM (SELECT * FROM copied EXCEPT ALL SELECT * FROM mapped) d)::int AS new_only`;
