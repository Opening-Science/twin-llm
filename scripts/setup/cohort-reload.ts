/**
 * `setup:local -- --reload-cohort`: remove one cohort's rows from the research
 * warehouse so the pinned cohort can be ingested in their place.
 *
 * Only the six warehouse tables are touched, and every statement is scoped by
 * the cohort id as a bound parameter. It runs in one transaction that also
 * counts every other cohort's subjects and bundles before and after; if those
 * counts move, or anything of this cohort is left, it throws and Postgres
 * rolls the whole delete back. Only cohorts listed in RELOADABLE_COHORTS can
 * be deleted at all.
 */
import { EVAL_COHORT } from "./cohort-pins";
import { type SqlClient, type SqlQuery } from "./detect";

/** The cohorts setup may delete and load again: the evaluation cohort only. */
export const RELOADABLE_COHORTS: readonly string[] = [EVAL_COHORT.cohortId];

export class ReloadRefusedError extends Error {}

/** The tables a cohort reload may delete from, in delete order. */
export const WAREHOUSE_TABLES = [
  "observations",
  "observation_non_numeric",
  "conditions",
  "medication_requests",
  "bundles",
  "subjects",
] as const;

type WarehouseTable = (typeof WAREHOUSE_TABLES)[number];

/**
 * The delete statements, one per table, each with the cohort id as `$1`.
 * Observation, condition and medication request rows go when either their
 * subject or their bundle is in the
 * cohort (ingest keeps the two in the same cohort; both are named so neither
 * is left behind). The foreign keys would cascade the same rows; spelling them
 * out keeps the scope readable here. Pure.
 */
export const cohortDeleteStatements = (): readonly Readonly<{
  table: WarehouseTable;
  sql: string;
}>[] => [
  {
    table: "observations",
    sql: "delete from observations where subject_ref in (select subject_ref from subjects where cohort_id = $1) or bundle_sha in (select sha from bundles where cohort_id = $1)",
  },
  {
    table: "observation_non_numeric",
    sql: "delete from observation_non_numeric where subject_ref in (select subject_ref from subjects where cohort_id = $1) or bundle_sha in (select sha from bundles where cohort_id = $1)",
  },
  {
    table: "conditions",
    sql: "delete from conditions where subject_ref in (select subject_ref from subjects where cohort_id = $1) or bundle_sha in (select sha from bundles where cohort_id = $1)",
  },
  {
    table: "medication_requests",
    sql: "delete from medication_requests where subject_ref in (select subject_ref from subjects where cohort_id = $1) or bundle_sha in (select sha from bundles where cohort_id = $1)",
  },
  { table: "bundles", sql: "delete from bundles where cohort_id = $1" },
  { table: "subjects", sql: "delete from subjects where cohort_id = $1" },
];

const OTHER_COHORTS_SQL =
  "select (select count(*)::bigint from subjects where cohort_id <> $1) as subjects, (select count(*)::bigint from bundles where cohort_id <> $1) as bundles";

const LEFT_SQL =
  "select (select count(*)::bigint from subjects where cohort_id = $1) + (select count(*)::bigint from bundles where cohort_id = $1) as left_rows";

const countsOf = async (tx: SqlQuery, cohortId: string): Promise<string> => {
  const [row] = await tx.unsafe(OTHER_COHORTS_SQL, [cohortId]);
  return `${String(row?.subjects)}/${String(row?.bundles)}`;
};

export type DeletedRows = Readonly<Record<WarehouseTable, number>>;

/**
 * Deletes `cohortId`'s warehouse rows in one transaction and returns how many
 * rows each table lost. Throws ReloadRefusedError (nothing deleted) for a
 * cohort that is not reloadable, or when the checks inside the transaction fail.
 */
export const deleteCohortRows = async (
  sql: SqlClient,
  cohortId: string,
): Promise<DeletedRows> => {
  if (!RELOADABLE_COHORTS.includes(cohortId)) {
    throw new ReloadRefusedError(
      `refusing to delete cohort ${cohortId}: only ${RELOADABLE_COHORTS.join(", ")} can be reloaded`,
    );
  }
  return sql.begin(async (tx) => {
    const before = await countsOf(tx, cohortId);
    const deleted: Partial<Record<WarehouseTable, number>> = {};
    for (const statement of cohortDeleteStatements()) {
      const [row] = await tx.unsafe(
        `with gone as (${statement.sql} returning 1) select count(*)::int as n from gone`,
        [cohortId],
      );
      deleted[statement.table] = Number(row?.n ?? 0);
    }
    const after = await countsOf(tx, cohortId);
    if (after !== before) {
      throw new ReloadRefusedError(
        `other cohorts' rows changed during the delete (${before} subjects/bundles before, ${after} after); rolled back, nothing deleted`,
      );
    }
    const [left] = await tx.unsafe(LEFT_SQL, [cohortId]);
    if (Number(left?.left_rows) !== 0) {
      throw new ReloadRefusedError(
        `${cohortId} still has rows after the delete; rolled back, nothing deleted`,
      );
    }
    return {
      observations: deleted.observations ?? 0,
      observation_non_numeric: deleted.observation_non_numeric ?? 0,
      conditions: deleted.conditions ?? 0,
      medication_requests: deleted.medication_requests ?? 0,
      bundles: deleted.bundles ?? 0,
      subjects: deleted.subjects ?? 0,
    };
  });
};

/** One line for the checklist. Pure. */
export const formatDeleted = (cohortId: string, deleted: DeletedRows): string =>
  `${cohortId}: deleted ${deleted.subjects} subjects, ${deleted.bundles} bundles, ${deleted.observations} observations, ${deleted.observation_non_numeric} non-numeric observations, ${deleted.conditions} conditions and ${deleted.medication_requests} medication requests`;
