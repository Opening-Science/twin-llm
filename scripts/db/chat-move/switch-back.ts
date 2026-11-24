/**
 * bun run db:chat-switch-back --yes
 *
 * Undoes the switch of the chat tables move (docs/storage.md, "Chat tables
 * move"): SWITCH_BACK_SQL in one transaction, so it happens whole or not at
 * all. Stop the app first. It drops the reverse triggers, puts the mirror
 * triggers back, points the scheduled_tasks and thread_search_embeddings
 * keys at threads again, marks the move backfilled and forgets the switch
 * migration. Then start the release before the switch: it reads and writes
 * threads, turns and model_responses, which the reverse triggers kept
 * complete. A later `bun run db:deploy` on the switched release switches
 * again. Prints both sides' row counts before and after; no rows change.
 *
 * The database is DATABASE_URL, as for the app.
 */
import type { PrismaClient } from "@/generated/prisma/client";

import { MOVE } from "./backfill-sql";
import { SWITCH_BACK_SQL } from "./switch-sql";

/** Long enough to validate the repointed keys on a full database. */
const SWITCH_BACK_TIMEOUT_MS = 10 * 60 * 1000;

const COUNTS_SQL = `SELECT
  (SELECT count(*) FROM "threads")::int AS threads,
  (SELECT count(*) FROM "turns")::int AS turns,
  (SELECT count(*) FROM "model_responses")::int AS model_responses,
  (SELECT count(*) FROM "conversations")::int AS conversations,
  (SELECT count(*) FROM "exchanges")::int AS exchanges,
  (SELECT count(*) FROM "answers")::int AS answers`;

export type ChatCounts = Readonly<Record<string, number>>;

export const countsLine = (when: string, counts: ChatCounts | undefined): string =>
  counts === undefined
    ? `${when}: no counts`
    : `${when}: ${Object.entries(counts)
        .map(([table, n]) => `${n} ${table}`)
        .join(", ")}`;

/** Runs every switch-back statement in one transaction; throws, changing nothing, on any error. */
export const runSwitchBack = async (db: PrismaClient): Promise<void> => {
  await db.$transaction(
    async (tx) => {
      for (const statement of SWITCH_BACK_SQL) await tx.$executeRawUnsafe(statement);
    },
    { maxWait: 60_000, timeout: SWITCH_BACK_TIMEOUT_MS },
  );
};

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  if (!process.argv.includes("--yes")) {
    console.error(
      "usage: bun run db:chat-switch-back --yes  (stop the app first; then run the release before the switch)",
    );
    process.exit(1);
  }
  const { database } = await import("../../../infrastructure/database");
  const db = database();
  try {
    const marker = await db.schemaMove
      .findUnique({ where: { move: MOVE } })
      .catch(() => null);
    if (marker?.phase !== "switched") {
      console.error(`db:chat-switch-back: the ${MOVE} move is not switched`);
      process.exitCode = 1;
    } else {
      const [before] = await db.$queryRawUnsafe<ChatCounts[]>(COUNTS_SQL);
      console.log(countsLine("before", before));
      try {
        await runSwitchBack(db);
        const [after] = await db.$queryRawUnsafe<ChatCounts[]>(COUNTS_SQL);
        console.log(countsLine("after", after));
        console.log(
          `${MOVE}: switched back to backfilled; run the release before the switch, and db:chat-parity`,
        );
      } catch {
        // The database's own message can quote row values; say what happened only.
        console.error("db:chat-switch-back FAIL: nothing was changed");
        process.exitCode = 1;
      }
    }
  } finally {
    await db.$disconnect();
  }
}
