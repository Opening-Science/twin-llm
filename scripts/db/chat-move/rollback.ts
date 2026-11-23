/**
 * bun run db:chat-rollback --yes
 *
 * Undoes the expand, mirror and backfill steps of the chat tables move
 * (docs/storage.md, "Chat tables move"): ROLLBACK_SQL in one transaction, so
 * it happens whole or not at all. Only before the switch: until then nothing
 * but the checks reads the new tables, and they skip copy tables that are
 * gone. threads, turns and model_responses are not touched; their row counts
 * are printed before and after. Take a fresh backup first, as for any schema
 * change. A later `bun run db:deploy` applies the three migrations again.
 *
 * The database is DATABASE_URL, as for the app.
 */
import type { PrismaClient } from "@/generated/prisma/client";

import { MOVE } from "./backfill-sql";
import { ROLLBACK_SQL } from "./rollback-sql";

/** Long enough to drop the copies of a full database; Prisma's default is 5 seconds. */
const ROLLBACK_TIMEOUT_MS = 10 * 60 * 1000;

const OLD_COUNTS_SQL = `SELECT
  (SELECT count(*) FROM "threads")::int AS threads,
  (SELECT count(*) FROM "turns")::int AS turns,
  (SELECT count(*) FROM "model_responses")::int AS model_responses`;

type OldCounts = { threads: number; turns: number; model_responses: number };

export const countLine = (when: string, counts: OldCounts | undefined): string =>
  counts === undefined
    ? `${when}: no counts`
    : `${when}: ${counts.threads} threads, ${counts.turns} turns, ${counts.model_responses} model_responses`;

/** Runs every rollback statement in one transaction; throws, changing nothing, on any error. */
export const runRollback = async (db: PrismaClient): Promise<void> => {
  await db.$transaction(
    async (tx) => {
      for (const statement of ROLLBACK_SQL) await tx.$executeRawUnsafe(statement);
    },
    { maxWait: 60_000, timeout: ROLLBACK_TIMEOUT_MS },
  );
};

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  if (!process.argv.includes("--yes")) {
    console.error(
      "usage: bun run db:chat-rollback --yes  (drops the chat copies; take a backup first)",
    );
    process.exit(1);
  }
  const { database } = await import("../../../infrastructure/database");
  const db = database();
  try {
    const marker = await db.schemaMove
      .findUnique({ where: { move: MOVE } })
      .catch(() => null);
    if (marker === null) {
      console.error(`db:chat-rollback: no ${MOVE} move to roll back`);
      process.exitCode = 1;
    } else {
      const [before] = await db.$queryRawUnsafe<OldCounts[]>(OLD_COUNTS_SQL);
      console.log(countLine("before", before));
      try {
        await runRollback(db);
        const [after] = await db.$queryRawUnsafe<OldCounts[]>(OLD_COUNTS_SQL);
        console.log(countLine("after", after));
        console.log(`${MOVE}: rolled back; db:deploy applies the move again`);
      } catch {
        // The database's own message can quote row values; say what happened only.
        console.error("db:chat-rollback FAIL: nothing was changed");
        process.exitCode = 1;
      }
    }
  } finally {
    await db.$disconnect();
  }
}
