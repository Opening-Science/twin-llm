import {
  addConstraintSql,
  FINISH_CONSTRAINTS,
  MOVE,
  validateConstraintSql,
} from "./backfill-sql";
import { DROP_MIRROR_SQL, MIRROR_SQL } from "./mirror-sql";
import { countsSql, ORPHAN_CHECKS } from "./parity-sql";
import { CHAT_MOVES, type ColumnCopy, type TableMove } from "./tables";

/**
 * The switch of the chat tables move (DATA-MODEL.md C.4). Pure: SQL text
 * only. The migration `chat_tables_switch` holds exactly SWITCH_SQL; a test
 * keeps them equal. `bun run db:chat-switch-back --yes` runs SWITCH_BACK_SQL.
 *
 * After the switch the app reads and writes conversations, exchanges and
 * answers. Reverse triggers repeat every write on threads, turns and
 * model_responses in the same transaction, so the old tables stay complete
 * for a switch back during the soak. The forward mirror triggers are dropped
 * in the same transaction as the reverse ones are created, so the two
 * directions never exist at once and a write can never bounce back.
 */

const quoted = (name: string): string => `"${name}"`;

/** The old column's value from the new row `NEW`: the mirror's mapping run backwards. */
export const reverseValueOf = (column: ColumnCopy): string => {
  const source = `NEW.${quoted(column.to)}`;
  switch (column.kind) {
    case "copy":
      return source;
    case "utc":
      return `(${source} AT TIME ZONE 'UTC')`;
    case "origin":
      return `(${source} = 'schedule')`;
    case "state":
      return `upper(${source}::text)::"model_response_status"`;
  }
};

const reverseFunction = (move: TableMove): string => {
  const name = quoted(`chat_move_reverse_${move.to}`);
  const columns = move.columns.map((column) => quoted(column.from)).join(", ");
  const values = move.columns.map(reverseValueOf).join(", ");
  const set = move.columns
    .filter((column) => column.from !== "id")
    .map((column) => `${quoted(column.from)} = EXCLUDED.${quoted(column.from)}`)
    .join(",\n        ");
  return `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD."id" <> NEW."id") THEN
    DELETE FROM ${quoted(move.from)} WHERE "id" = OLD."id";
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  INSERT INTO ${quoted(move.from)} (${columns})
  VALUES (${values})
  ON CONFLICT ("id") DO UPDATE
    SET ${set};
  RETURN NEW;
END;
$$;

CREATE TRIGGER "chat_move_reverse" AFTER INSERT OR UPDATE OR DELETE ON ${quoted(move.to)}
  FOR EACH ROW EXECUTE FUNCTION ${name}();`;
};

/** Reverse triggers on conversations, exchanges and answers (new → old). */
export const REVERSE_SQL = CHAT_MOVES.map(reverseFunction).join("\n\n");

export const DROP_REVERSE_SQL = CHAT_MOVES.map(
  (move) =>
    `DROP TRIGGER IF EXISTS "chat_move_reverse" ON "${move.to}";\nDROP FUNCTION IF EXISTS "chat_move_reverse_${move.to}"();`,
).join("\n");

/** The two neighbours whose thread foreign key follows the app to the new tables. */
export const REPOINTED_KEYS = [
  { table: "scheduled_tasks", name: "scheduled_tasks_thread_id_fkey" },
  { table: "thread_search_embeddings", name: "thread_search_embeddings_thread_id_fkey" },
] as const;

/** Points one neighbour's `thread_id` key at `target`: NOT VALID first, then validated. */
const repointSql = (target: "conversations" | "threads"): readonly string[] =>
  REPOINTED_KEYS.flatMap((key) => [
    `ALTER TABLE "${key.table}" DROP CONSTRAINT "${key.name}";`,
    `ALTER TABLE "${key.table}" ADD CONSTRAINT "${key.name}" FOREIGN KEY ("thread_id") REFERENCES "${target}"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;`,
    `ALTER TABLE "${key.table}" VALIDATE CONSTRAINT "${key.name}";`,
  ]);

const phaseCheckSql = (phases: readonly string[]): readonly string[] => [
  `ALTER TABLE "schema_moves" DROP CONSTRAINT "schema_moves_phase";`,
  `ALTER TABLE "schema_moves" ADD CONSTRAINT "schema_moves_phase" CHECK ("phase" IN (${phases
    .map((phase) => `'${phase}'`)
    .join(", ")}));`,
];

const markSql = (phase: string): string =>
  `UPDATE "schema_moves" SET "phase" = '${phase}', "updated_at" = CURRENT_TIMESTAMP WHERE "move" = '${MOVE}';`;

/** Both sides of the move: no writer may slip in between the checks and the swap. */
const LOCK_SQL = `LOCK TABLE "threads", "turns", "model_responses", "conversations", "exchanges", "answers" IN SHARE ROW EXCLUSIVE MODE;`;

const SUM_OF_PROBLEMS = (move: TableMove): string =>
  `SELECT abs(c.old_rows - c.new_rows) + c.missing + c.extra + c.differing FROM (${countsSql(move)}) c`;

/**
 * Refuses the switch unless the move is backfilled and every copy matches
 * (the db:chat-parity gate, run inside the switch's own transaction), or the
 * install is new and every chat table is empty. The messages name the
 * command to run, never a row.
 */
export const SWITCH_GUARD_SQL = `DO $$
DECLARE
  current_phase text;
  problems bigint;
BEGIN
  SELECT m."phase" INTO current_phase FROM "schema_moves" m WHERE m."move" = '${MOVE}';
  IF current_phase IS NULL THEN
    RAISE EXCEPTION 'chat-tables switch: no move marker; run bun run db:deploy from a release with the expand step';
  END IF;
  IF current_phase = 'switched' THEN
    RAISE EXCEPTION 'chat-tables switch: the move is switched already';
  END IF;
  IF current_phase = 'expanded' AND (
    EXISTS (SELECT 1 FROM "threads") OR EXISTS (SELECT 1 FROM "conversations")
  ) THEN
    RAISE EXCEPTION 'chat-tables switch: the move is not backfilled; run bun run db:chat-backfill, then bun run db:chat-parity';
  END IF;
${CHAT_MOVES.map(
  (move) => `  ${SUM_OF_PROBLEMS(move).replace(/\n/g, "\n  ")} INTO problems;
  IF problems <> 0 THEN
    RAISE EXCEPTION 'chat-tables switch: ${move.to} does not match ${move.from}; run bun run db:chat-parity';
  END IF;`,
).join("\n")}
${ORPHAN_CHECKS.map(
  (check) => `  SELECT o.n INTO problems FROM (${check.sql.replace(/\n/g, "\n  ")}) o;
  IF problems <> 0 THEN
    RAISE EXCEPTION 'chat-tables switch: ${check.name.replace(/'/g, "''")}; run bun run db:chat-parity';
  END IF;`,
).join("\n")}
END;
$$;`;

/**
 * The switch, in order, in one transaction: lock, check, add the new
 * tables' keys where a fresh install has none yet, swap the triggers,
 * repoint the neighbours' keys and mark the move switched.
 */
export const SWITCH_SQL: readonly string[] = [
  LOCK_SQL,
  SWITCH_GUARD_SQL,
  ...FINISH_CONSTRAINTS.flatMap((constraint) => [
    `${addConstraintSql(constraint)};`,
    `${validateConstraintSql(constraint)};`,
  ]),
  ...DROP_MIRROR_SQL.split("\n"),
  ...REVERSE_SQL.split("\n\n"),
  ...repointSql("conversations"),
  ...phaseCheckSql(["expanded", "backfilled", "switched"]),
  markSql("switched"),
];

/** The migration that holds SWITCH_SQL; a switch back forgets it, so db:deploy applies it again. */
export const SWITCH_MIGRATION = "20261124120000_chat_tables_switch";

export const FORGET_SWITCH_SQL = `DELETE FROM "_prisma_migrations" WHERE "migration_name" = '${SWITCH_MIGRATION}';`;

export const SWITCH_BACK_GUARD_SQL = `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "schema_moves" WHERE "move" = '${MOVE}' AND "phase" = 'switched') THEN
    RAISE EXCEPTION 'chat-tables switch back: the move is not switched';
  END IF;
END;
$$;`;

/**
 * Back from switched to backfilled (DATA-MODEL.md C.4, "Rollback"): the
 * reverse triggers kept the old tables complete, so the forward mirror takes
 * over again from the same rows. The new tables, their rows and their keys
 * stay, as after the backfill. Then the release before the switch runs.
 */
export const SWITCH_BACK_SQL: readonly string[] = [
  LOCK_SQL,
  SWITCH_BACK_GUARD_SQL,
  ...DROP_REVERSE_SQL.split("\n"),
  ...MIRROR_SQL.split("\n\n"),
  ...repointSql("threads"),
  markSql("backfilled"),
  ...phaseCheckSql(["expanded", "backfilled"]),
  FORGET_SWITCH_SQL,
];

/** The migration file's body: SWITCH_SQL, one statement per paragraph. */
export const switchMigrationBody = (): string => `${SWITCH_SQL.join("\n\n")}\n`;
