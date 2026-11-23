import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { finishBackfill, runBackfill } from "./backfill";
import { UNDO_FINISH_SQL } from "./backfill-sql";
import { liveDatabase, requireNoThreads, runLive } from "./live.test-helpers";
import { checkedTables, plaintextFindings } from "@/infrastructure/reseal";

import { ROLLBACK_SQL } from "./rollback-sql";
import { clearSeed, seedOldChats } from "./seed.test-helpers";

/**
 * The rollback of the chat tables move against a real Postgres, with
 * made-up rows only. Postgres DDL is transactional, so the rollback runs
 * inside a transaction that is undone at the end: the checks see the
 * database as a rollback would leave it, and the next test still finds the
 * new tables.
 *   RUN_LIVE=1 DATABASE_URL=<throwaway, migrated> bun test scripts/db/chat-move/rollback.live.test.ts
 */

/** One digest per old table: every column of every row, in id order. */
const OLD_DIGEST_SQL = ["threads", "turns", "model_responses"]
  .map(
    (table) =>
      `SELECT '${table}' AS t, count(*)::int AS n, coalesce(md5(string_agg(x::text, '|' ORDER BY x."id")), '') AS d FROM "${table}" x`,
  )
  .join(" UNION ALL ");

const LEFT_SQL = `SELECT
  (SELECT count(*)::int FROM pg_class WHERE relname IN ('conversations', 'exchanges', 'answers', 'schema_moves', 'schema_move_cursors')) AS tables,
  (SELECT count(*)::int FROM pg_type WHERE typname IN ('answer_state', 'exchange_origin')) AS types,
  (SELECT count(*)::int FROM pg_trigger WHERE tgname = 'chat_move_mirror') AS triggers,
  (SELECT count(*)::int FROM "_prisma_migrations" WHERE migration_name LIKE '20261118120%') AS migrations`;

type Digest = { t: string; n: number; d: string };
type Left = { tables: number; types: number; triggers: number; migrations: number };

const UNDONE = "undone on purpose";

describe.skipIf(!runLive)("chat move rollback (RUN_LIVE=1)", () => {
  const db = liveDatabase();
  const log = () => undefined;

  beforeAll(async () => {
    await requireNoThreads(db);
    await seedOldChats(db, 20);
    await runBackfill(db, { batchSize: 50, log });
    await finishBackfill(db, log);
  });
  afterAll(async () => {
    await clearSeed(db, UNDO_FINISH_SQL);
    await db.$disconnect();
  });

  test("rolling back drops every new object and leaves the old tables byte for byte", async () => {
    const before = await db.$queryRawUnsafe<Digest[]>(OLD_DIGEST_SQL);
    expect(before.every((row) => row.n > 0)).toBe(true);
    const seen: { after: Digest[]; left: Left[]; checked: string[]; findings: number } = {
      after: [],
      left: [],
      checked: [],
      findings: -1,
    };
    const outcome = await db
      .$transaction(async (tx) => {
        for (const statement of ROLLBACK_SQL) await tx.$executeRawUnsafe(statement);
        seen.after = await tx.$queryRawUnsafe<Digest[]>(OLD_DIGEST_SQL);
        seen.left = await tx.$queryRawUnsafe<Left[]>(LEFT_SQL);
        // The doctor, the Lab and the vault scripts still run on this code.
        const run = async (sql: string, params: readonly unknown[]) => {
          const rows: unknown = await tx.$queryRawUnsafe(sql, ...params);
          return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
        };
        seen.checked = (await checkedTables(run)).map((entry) => entry.table);
        seen.findings = (await plaintextFindings(run)).length;
        // The app's write path still works without the new tables.
        await tx.thread.create({
          data: { id: "rollback-new", userId: "move-seed-a", title: "x" },
        });
        await tx.turn.create({
          data: { id: "rollback-new-q", threadId: "rollback-new", prompt: "x" },
        });
        await tx.thread.delete({ where: { id: "seed-0-001" } });
        throw new Error(UNDONE);
      })
      .then(
        () => "committed",
        (error: unknown) => (error instanceof Error ? error.message : "other"),
      );
    expect(outcome).toBe(UNDONE);
    expect(seen.after).toEqual(before);
    expect(seen.left).toEqual([{ tables: 0, types: 0, triggers: 0, migrations: 0 }]);
    expect(seen.checked).toContain("model_responses");
    expect(seen.checked).not.toContain("answers");
    expect(seen.findings).toBeGreaterThanOrEqual(0);
    // The transaction was undone: the copies and the marker are back.
    expect(await db.conversation.count()).toBe(before[0]?.n ?? -1);
    expect(
      (await db.schemaMove.findUniqueOrThrow({ where: { move: "chat-tables" } })).phase,
    ).toBe("backfilled");
  });
});
