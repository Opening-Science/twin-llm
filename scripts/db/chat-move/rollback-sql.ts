import { DROP_MIRROR_SQL } from "./mirror-sql";

/**
 * Undoing the expand, mirror and backfill steps of the chat tables move
 * (DATA-MODEL.md C.1, "Rollback"), in order. Before the switch only the
 * checks read the new tables, and they skip copy tables that are gone, so
 * dropping them loses nothing: every row in them is a copy, and threads,
 * turns and model_responses are not touched. Pure: SQL text only;
 * `bun run db:chat-rollback --yes` (rollback.ts) runs it.
 */

/** The migrations these statements undo, newest first. */
export const ROLLED_BACK_MIGRATIONS = [
  "20261118120200_chat_tables_mirror",
  "20261118120100_schema_moves",
  "20261118120000_chat_tables_expand",
] as const;

/**
 * Prisma's `migrate resolve --rolled-back` only accepts a failed migration,
 * so the rollback forgets the three applied ones itself; the next
 * `db:deploy` applies them again.
 */
export const FORGET_MIGRATIONS_SQL = `DELETE FROM "_prisma_migrations" WHERE "migration_name" IN (${ROLLED_BACK_MIGRATIONS.map(
  (name) => `'${name}'`,
).join(", ")})`;

export const ROLLBACK_SQL: readonly string[] = [
  ...DROP_MIRROR_SQL.split("\n"),
  `DROP TABLE IF EXISTS "answers"`,
  `DROP TABLE IF EXISTS "exchanges"`,
  `DROP TABLE IF EXISTS "conversations"`,
  `DROP TYPE IF EXISTS "answer_state"`,
  `DROP TYPE IF EXISTS "exchange_origin"`,
  `DROP TABLE IF EXISTS "schema_move_cursors"`,
  `DROP TABLE IF EXISTS "schema_moves"`,
  FORGET_MIGRATIONS_SQL,
];
