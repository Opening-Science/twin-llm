import {
  CHAT_MOVES,
  EXCHANGES,
  sourceValues,
  type TableMove,
  targetColumns,
} from "./tables";

/**
 * The SQL of the chat backfill (DATA-MODEL.md C.2). Pure: SQL text only.
 *
 * One batch reads the next old rows after the cursor in id order, with a
 * share lock (a concurrent delete or update waits for the batch, so a
 * deleted row is never brought back and a newer copy is never replaced by
 * an older one), and inserts their copies with ON CONFLICT DO NOTHING (a
 * copy the mirror triggers already wrote is newer and stays).
 */

export const MOVE = "chat-tables";

/**
 * The schedule of an old scheduled turn: the task whose `last_turn_id` names
 * it, else the one task whose thread is the turn's thread, else null.
 * `origin` keeps the exact old flag, so nothing is lost when this is null.
 */
const SCHEDULE_OF_OLD_TURN = `CASE WHEN o."scheduled" THEN COALESCE(
      (SELECT min(s."id") FROM "scheduled_tasks" s WHERE s."last_turn_id" = o."id" HAVING count(*) = 1),
      (SELECT min(s."id") FROM "scheduled_tasks" s WHERE s."thread_id" = o."threadId" HAVING count(*) = 1)
    ) END`;

const insertColumns = (move: TableMove): string =>
  move === EXCHANGES ? `${targetColumns(move)}, "schedule_id"` : targetColumns(move);

const insertValues = (move: TableMove): string =>
  move === EXCHANGES
    ? `${sourceValues(move, "o")}, ${SCHEDULE_OF_OLD_TURN}`
    : sourceValues(move, "o");

/**
 * One batch. Parameters: $1 the last id copied (null at the start), $2 the
 * batch size. Returns the batch's last id, how many old rows it read and
 * how many copies it inserted.
 */
export const batchSql = (move: TableMove): string => `WITH batch AS (
  SELECT o.* FROM "${move.from}" o
   WHERE $1::text IS NULL OR o."id" > $1::text
   ORDER BY o."id"
   LIMIT $2::int
   FOR SHARE
), copied AS (
  INSERT INTO "${move.to}" (${insertColumns(move)})
  SELECT ${insertValues(move)} FROM batch o
  ON CONFLICT ("id") DO NOTHING
  RETURNING 1
)
SELECT (SELECT max(b."id") FROM batch b) AS last_id,
       (SELECT count(*) FROM batch)::int AS seen,
       (SELECT count(*) FROM copied)::int AS inserted`;

/** Locks the cursor row so two backfills never copy the same table at once. */
export const LOCK_CURSOR_SQL = `INSERT INTO "schema_move_cursors" ("move", "table_name")
VALUES ($1, $2)
ON CONFLICT ("move", "table_name") DO UPDATE SET "move" = EXCLUDED."move"
RETURNING "last_id"`;

export const ADVANCE_CURSOR_SQL = `UPDATE "schema_move_cursors"
   SET "last_id" = $3, "copied" = "copied" + $4, "updated_at" = CURRENT_TIMESTAMP
 WHERE "move" = $1 AND "table_name" = $2`;

/** A constraint the finish step adds, NOT VALID first and then validated. */
export type FinishConstraint = Readonly<{
  table: string;
  name: string;
  definition: string;
}>;

export const FINISH_CONSTRAINTS: readonly FinishConstraint[] = [
  {
    table: "conversations",
    name: "conversations_owner_id_fkey",
    definition: `FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  },
  {
    table: "exchanges",
    name: "exchanges_conversation_id_fkey",
    definition: `FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  },
  {
    table: "exchanges",
    name: "exchanges_schedule_id_fkey",
    definition: `FOREIGN KEY ("schedule_id") REFERENCES "scheduled_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE`,
  },
  {
    table: "exchanges",
    name: "exchanges_schedule_only_when_scheduled",
    definition: `CHECK ("origin" = 'schedule' OR "schedule_id" IS NULL)`,
  },
  {
    table: "answers",
    name: "answers_exchange_id_fkey",
    definition: `FOREIGN KEY ("exchange_id") REFERENCES "exchanges"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  },
];

/** Adds the constraint unless it is there; it does not check old rows yet. */
export const addConstraintSql = (constraint: FinishConstraint): string => `DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = '${constraint.name}' AND conrelid = '"${constraint.table}"'::regclass
  ) THEN
    ALTER TABLE "${constraint.table}" ADD CONSTRAINT "${constraint.name}" ${constraint.definition} NOT VALID;
  END IF;
END;
$$`;

/** Checks every existing row; takes no lock that blocks writers. */
export const validateConstraintSql = (constraint: FinishConstraint): string =>
  `ALTER TABLE "${constraint.table}" VALIDATE CONSTRAINT "${constraint.name}"`;

/**
 * A schedule naming a task that no longer exists cannot pass the foreign
 * key; ON DELETE SET NULL would have cleared it, so the finish step does.
 */
export const CLEAR_LOST_SCHEDULES_SQL = `UPDATE "exchanges" e SET "schedule_id" = NULL
 WHERE e."schedule_id" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "scheduled_tasks" s WHERE s."id" = e."schedule_id")`;

export const MARK_BACKFILLED_SQL = `UPDATE "schema_moves"
   SET "phase" = 'backfilled', "updated_at" = CURRENT_TIMESTAMP
 WHERE "move" = $1`;

/**
 * Undoes the finish step and forgets the cursors (rollback, or a rehearsal
 * that starts over). The copied rows stay; the mirror keeps them current.
 */
export const UNDO_FINISH_SQL: readonly string[] = [
  ...[...FINISH_CONSTRAINTS]
    .reverse()
    .map(
      (constraint) =>
        `ALTER TABLE "${constraint.table}" DROP CONSTRAINT IF EXISTS "${constraint.name}"`,
    ),
  `DELETE FROM "schema_move_cursors" WHERE "move" = '${MOVE}'`,
  `UPDATE "schema_moves" SET "phase" = 'expanded', "updated_at" = CURRENT_TIMESTAMP WHERE "move" = '${MOVE}'`,
];

export { CHAT_MOVES };
