import { type ColumnCopy, sourceValues, type TableMove, targetColumns } from "./tables";

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

const columnsOf = (move: TableMove, alias: string): string =>
  move.columns.map((column) => `${alias}."${column.to}"`).join(", ");

/**
 * Per table pair: row counts, ids on one side only, and rows on both sides
 * whose copy differs from the mapped old row in any column.
 */
export const countsSql = (move: TableMove): string => `SELECT
  (SELECT count(*) FROM "${move.from}")::int AS old_rows,
  (SELECT count(*) FROM "${move.to}")::int AS new_rows,
  (SELECT count(*) FROM "${move.from}" o
    WHERE NOT EXISTS (SELECT 1 FROM "${move.to}" n WHERE n."id" = o."id"))::int AS missing,
  (SELECT count(*) FROM "${move.to}" n
    WHERE NOT EXISTS (SELECT 1 FROM "${move.from}" o WHERE o."id" = n."id"))::int AS extra,
  (SELECT count(*) FROM "${move.from}" o JOIN "${move.to}" n ON n."id" = o."id"
    WHERE ROW(${sourceValues(move, "o")}) IS DISTINCT FROM ROW(${columnsOf(move, "n")}))::int AS differing`;

export type OrphanCheck = Readonly<{ name: string; sql: string }>;

/** Each returns `n`, the number of rows that break the rule; all must be 0. */
export const ORPHAN_CHECKS: readonly OrphanCheck[] = [
  {
    name: "conversations without their person",
    sql: `SELECT count(*)::int AS n FROM "conversations" c
           WHERE NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = c."owner_id")`,
  },
  {
    name: "exchanges without their conversation",
    sql: `SELECT count(*)::int AS n FROM "exchanges" e
           WHERE NOT EXISTS (SELECT 1 FROM "conversations" c WHERE c."id" = e."conversation_id")`,
  },
  {
    name: "answers without their exchange",
    sql: `SELECT count(*)::int AS n FROM "answers" a
           WHERE NOT EXISTS (SELECT 1 FROM "exchanges" e WHERE e."id" = a."exchange_id")`,
  },
  {
    name: "schedules naming no task",
    sql: `SELECT count(*)::int AS n FROM "exchanges" e
           WHERE e."schedule_id" IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM "scheduled_tasks" s WHERE s."id" = e."schedule_id")`,
  },
  {
    name: "schedules on a person's exchange",
    sql: `SELECT count(*)::int AS n FROM "exchanges" e
           WHERE e."origin" = 'person' AND e."schedule_id" IS NOT NULL`,
  },
];

const OWNER_OF_OLD_ROW: Readonly<Record<string, string>> = {
  threads: `o."userId"`,
  turns: `(SELECT t."userId" FROM "threads" t WHERE t."id" = o."threadId")`,
  model_responses: `(SELECT t."userId" FROM "turns" u JOIN "threads" t ON t."id" = u."threadId" WHERE u."id" = o."turnId")`,
};

/** One sealed column's old and new values side by side, with the row's owner. */
export const sealedPairsSql = (move: TableMove, column: ColumnCopy): string => `SELECT
  o."id" AS id,
  ${OWNER_OF_OLD_ROW[move.from] ?? "NULL"} AS owner_id,
  o."${column.from}" AS old_value,
  n."${column.to}" AS new_value
FROM "${move.from}" o LEFT JOIN "${move.to}" n ON n."id" = o."id"
ORDER BY o."id"`;
