import { PrismaClient } from "@/generated/prisma/client";
import { postgresAdapter } from "@/infrastructure/database-adapter";

import { MOVE, UNDO_FINISH_SQL } from "./backfill-sql";
import { FORGET_SWITCH_SQL, SWITCH_BACK_SQL, SWITCH_SQL } from "./switch-sql";

/**
 * A client for the chat-move live tests, which run against a throwaway,
 * migrated database only:
 *   RUN_LIVE=1 DATABASE_URL=<throwaway, migrated> bun test scripts/db/chat-move
 */

export const runLive = Reflect.get(process.env, "RUN_LIVE") === "1";

export const liveDatabase = (): PrismaClient =>
  new PrismaClient({
    adapter: postgresAdapter(String(Reflect.get(process.env, "DATABASE_URL") ?? "")),
  });

export type ColumnShape = Readonly<{
  column: string;
  type: string;
  nullable: boolean;
  precision: number | null;
  scale: number | null;
}>;

/** A table's columns as Postgres describes them, by name. */
export const columnShapes = async (
  db: PrismaClient,
  table: string,
): Promise<ReadonlyMap<string, ColumnShape>> => {
  const rows = await db.$queryRaw<
    {
      column_name: string;
      data_type: string;
      udt_name: string;
      is_nullable: string;
      numeric_precision: number | null;
      numeric_scale: number | null;
      datetime_precision: number | null;
    }[]
  >`SELECT column_name, data_type, udt_name, is_nullable, numeric_precision,
           numeric_scale, datetime_precision
      FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = ${table}`;
  return new Map(
    rows.map((row) => [
      row.column_name,
      {
        column: row.column_name,
        type: row.data_type === "USER-DEFINED" ? row.udt_name : row.data_type,
        nullable: row.is_nullable === "YES",
        precision: row.numeric_precision ?? row.datetime_precision,
        scale: row.numeric_scale,
      },
    ]),
  );
};

/**
 * The release-1 live tests (expand, mirror, backfill, parity, rollback)
 * rehearse the move before the switch. A database migrated to the newest
 * schema is switched, so they first put it back as the expand and mirror
 * migrations left it: switched back, the backfill's finish step undone and
 * the phase `expanded`. The switch migration stays recorded.
 */
export const asBeforeSwitch = async (db: PrismaClient): Promise<void> => {
  const marker = await db.schemaMove.findUnique({ where: { move: MOVE } });
  if (marker?.phase !== "switched") return;
  await db.$transaction(
    async (tx) => {
      for (const statement of SWITCH_BACK_SQL.filter((s) => s !== FORGET_SWITCH_SQL)) {
        await tx.$executeRawUnsafe(statement);
      }
      for (const statement of UNDO_FINISH_SQL) await tx.$executeRawUnsafe(statement);
    },
    { timeout: 60_000 },
  );
};

/** Switches again once a release-1 test has cleared its rows, as the migration does. */
export const asSwitched = async (db: PrismaClient): Promise<void> => {
  const marker = await db.schemaMove.findUnique({ where: { move: MOVE } });
  if (marker?.phase === "switched") return;
  await db.$transaction(
    async (tx) => {
      for (const statement of SWITCH_SQL) await tx.$executeRawUnsafe(statement);
    },
    { timeout: 60_000 },
  );
};

/** Refuses to run on a database that already holds conversations. */
export const requireNoThreads = async (db: PrismaClient): Promise<void> => {
  const existing = await db.thread.count();
  if (existing > 0) {
    throw new Error(`${existing} threads already stored; use a throwaway database`);
  }
};
