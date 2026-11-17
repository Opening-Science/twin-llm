import {
  ANSWERS,
  CONVERSATIONS,
  EXCHANGES,
  sourceValues,
  type TableMove,
  targetColumns,
} from "./tables";

/**
 * The SQL of the mirror triggers (DATA-MODEL.md C.1 step 2): every insert,
 * update and delete on threads, turns and model_responses is repeated on
 * conversations, exchanges and answers in the same transaction, so the new
 * tables stay current while the backfill copies older rows. The migration
 * `chat_tables_mirror` holds exactly this text; a test keeps them equal.
 *
 * Pure: builds SQL text from the column map.
 */

const quoted = (name: string): string => `"${name}"`;

/** `"col" = EXCLUDED."col"` for every copied column but the id. */
const overwrite = (move: TableMove): readonly string[] =>
  move.columns
    .filter((column) => column.to !== "id")
    .map((column) => `${quoted(column.to)} = EXCLUDED.${quoted(column.to)}`);

/**
 * The scheduled task that asked a new turn, when it can be told: the one
 * task whose thread is the turn's thread. Null for a person's turn, for a
 * task's first run (its thread is set only when the run ends; the
 * scheduled_tasks trigger fills it then) and when two tasks share a thread.
 */
const SCHEDULE_GUESS = `CASE WHEN NEW."scheduled" THEN (
      SELECT min(s."id") FROM "scheduled_tasks" s
       WHERE s."thread_id" = NEW."threadId"
      HAVING count(*) = 1
    ) END`;

const mirrorFunction = (
  move: TableMove,
  extra: Readonly<{ columns: string; values: string; set: readonly string[] }> | null,
): string => {
  const name = quoted(`chat_move_mirror_${move.from}`);
  const columns =
    extra === null ? targetColumns(move) : `${targetColumns(move)}, ${extra.columns}`;
  const values =
    extra === null
      ? sourceValues(move, "NEW")
      : `${sourceValues(move, "NEW")}, ${extra.values}`;
  const set = [...overwrite(move), ...(extra?.set ?? [])].join(",\n        ");
  return `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD."id" <> NEW."id") THEN
    DELETE FROM ${quoted(move.to)} WHERE "id" = OLD."id";
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  INSERT INTO ${quoted(move.to)} (${columns})
  VALUES (${values})
  ON CONFLICT ("id") DO UPDATE
    SET ${set};
  RETURN NEW;
END;
$$;

CREATE TRIGGER "chat_move_mirror" AFTER INSERT OR UPDATE OR DELETE ON ${quoted(move.from)}
  FOR EACH ROW EXECUTE FUNCTION ${name}();`;
};

/**
 * When a run ends, its task records the turn it asked (`last_turn_id`):
 * that names the exchange's schedule exactly. Deleting a task clears the
 * schedule of its exchanges, as ON DELETE SET NULL will once the foreign
 * key exists; their origin stays `schedule`.
 */
const TASK_FUNCTION = `CREATE FUNCTION "chat_move_mirror_scheduled_tasks"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE "exchanges" SET "schedule_id" = NULL WHERE "schedule_id" = OLD."id";
    RETURN OLD;
  END IF;
  IF NEW."last_turn_id" IS NOT NULL THEN
    UPDATE "exchanges" SET "schedule_id" = NEW."id"
     WHERE "id" = NEW."last_turn_id" AND "origin" = 'schedule'
       AND "schedule_id" IS DISTINCT FROM NEW."id";
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "chat_move_mirror" AFTER INSERT OR UPDATE OF "last_turn_id" OR DELETE ON "scheduled_tasks"
  FOR EACH ROW EXECUTE FUNCTION "chat_move_mirror_scheduled_tasks"();`;

export const MIRROR_SQL = [
  mirrorFunction(CONVERSATIONS, null),
  mirrorFunction(EXCHANGES, {
    columns: `"schedule_id"`,
    values: SCHEDULE_GUESS,
    // An update never forgets a schedule already known.
    set: [`"schedule_id" = COALESCE("exchanges"."schedule_id", EXCLUDED."schedule_id")`],
  }),
  mirrorFunction(ANSWERS, null),
  TASK_FUNCTION,
].join("\n\n");

/** The SQL that removes the triggers again (rollback, or the switch step). */
export const DROP_MIRROR_SQL = ["threads", "turns", "model_responses", "scheduled_tasks"]
  .map(
    (table) =>
      `DROP TRIGGER IF EXISTS "chat_move_mirror" ON "${table}";\nDROP FUNCTION IF EXISTS "chat_move_mirror_${table}"();`,
  )
  .join("\n");
