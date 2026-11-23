import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { finishBackfill, runBackfill } from "./backfill";
import { batchSql, FINISH_CONSTRAINTS, MOVE, UNDO_FINISH_SQL } from "./backfill-sql";
import { liveDatabase, requireNoThreads, runLive } from "./live.test-helpers";
import { differencesSql } from "./parity-sql";
import { clearSeed, SEED_USERS, type SeedShape, seedOldChats } from "./seed.test-helpers";
import { CHAT_MOVES } from "./tables";

/**
 * The chat backfill against a real Postgres (DATA-MODEL.md D.3), with
 * made-up rows only: rows older than the triggers are copied, a run stopped
 * halfway resumes, writes between batches are neither lost nor undone, a
 * third run inserts nothing, and every copy equals its old row.
 *   RUN_LIVE=1 DATABASE_URL=<throwaway, migrated> bun test scripts/db/chat-move/backfill.live.test.ts
 */

describe.skipIf(!runLive)("chat backfill (RUN_LIVE=1)", () => {
  const db = liveDatabase();
  const lines: string[] = [];
  const log = (line: string) => lines.push(line);
  let seed: SeedShape;

  const counts = async () => ({
    conversations: await db.conversation.count(),
    exchanges: await db.exchange.count(),
    answers: await db.answer.count(),
  });

  const differences = async () => {
    const found: Record<string, unknown> = {};
    for (const move of CHAT_MOVES) {
      const [row] = await db.$queryRawUnsafe<{ old_only: number; new_only: number }[]>(
        differencesSql(move),
      );
      found[move.to] = row;
    }
    return found;
  };

  const none = Object.fromEntries(
    CHAT_MOVES.map((move) => [move.to, { old_only: 0, new_only: 0 }]),
  );

  beforeAll(async () => {
    await requireNoThreads(db);
    seed = await seedOldChats(db, 20);
  });
  afterAll(async () => {
    await clearSeed(db, UNDO_FINISH_SQL);
    await db.$disconnect();
  });

  test("rows written before the triggers have no copies yet", async () => {
    expect(seed.threads).toBe(40);
    expect(await counts()).toEqual({ conversations: 0, exchanges: 0, answers: 0 });
  });

  test("a run stopped halfway copies part and records where it stopped", async () => {
    const result = await runBackfill(db, { batchSize: 7, maxBatches: 8, log });
    expect(result.complete).toBe(false);
    const now = await counts();
    expect(now.conversations).toBe(40);
    expect(now.exchanges).toBeGreaterThan(0);
    expect(now.exchanges).toBeLessThan(seed.turns);
    expect(now.answers).toBe(0);
    const cursors = await db.schemaMoveCursor.findMany({ where: { move: MOVE } });
    expect(cursors.map((cursor) => [cursor.tableName, cursor.copied]).sort()).toEqual([
      ["conversations", 40],
      ["exchanges", now.exchanges],
    ]);
  });

  test("the next run resumes, and writes between its batches are kept", async () => {
    let wrote = false;
    const afterBatch = async (table: string) => {
      if (table !== "answers" || wrote) return;
      wrote = true;
      // Behind the cursor (copied): an update and a delete.
      await db.thread.update({ where: { id: "seed-0-000" }, data: { title: "renamed" } });
      await db.thread.delete({ where: { id: "seed-0-001" } });
      // Ahead of the cursor (not yet copied): an answer completes, a turn goes.
      await db.modelResponse.update({
        where: { id: "seed-1-019-q0-a0" },
        data: { status: "COMPLETE", text: "tlenc1.k-made-up.bGF0ZQ==" },
      });
      await db.turn.delete({ where: { id: "seed-1-019-q1" } });
      // Brand new, while the backfill runs.
      await db.thread.create({
        data: { id: "seed-new", userId: SEED_USERS[1], title: "new during backfill" },
      });
      await db.turn.create({
        data: { id: "seed-new-q0", threadId: "seed-new", prompt: "new" },
      });
      await db.modelResponse.create({
        data: {
          id: "seed-new-q0-a0",
          turnId: "seed-new-q0",
          modelId: "m",
          modelName: "M",
        },
      });
    };
    const result = await runBackfill(db, { batchSize: 7, afterBatch, log });
    expect(result.complete).toBe(true);
    expect(wrote).toBe(true);
    expect(await differences()).toEqual(none);
    expect(await db.conversation.findUnique({ where: { id: "seed-0-001" } })).toBeNull();
    expect(
      (await db.conversation.findUniqueOrThrow({ where: { id: "seed-0-000" } }))
        .titleSealed,
    ).toBe("renamed");
    expect(
      await db.answer.findUniqueOrThrow({ where: { id: "seed-1-019-q0-a0" } }),
    ).toMatchObject({
      state: "complete",
      bodySealed: "tlenc1.k-made-up.bGF0ZQ==",
    });
  });

  test("a third run inserts nothing", async () => {
    const before = await counts();
    const result = await runBackfill(db, { batchSize: 1000, log });
    expect(result.tables.map((table) => table.inserted)).toEqual([0, 0, 0]);
    expect(await counts()).toEqual(before);
  });

  test("each batch reaches its cursor through the primary key, also on a generic plan", async () => {
    const plans = await db.$transaction(async (tx) => {
      const found: string[] = [];
      await tx.$executeRawUnsafe(`SET LOCAL plan_cache_mode = force_generic_plan`);
      for (const move of CHAT_MOVES) {
        await tx.$executeRawUnsafe(`PREPARE chat_batch(text, int) AS ${batchSql(move)}`);
        const rows = await tx.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(
          `EXPLAIN (COSTS OFF) EXECUTE chat_batch('m', 10)`,
        );
        found.push(rows.map((row) => row["QUERY PLAN"]).join("\n"));
        await tx.$executeRawUnsafe(`DEALLOCATE chat_batch`);
      }
      return found;
    });
    for (const [index, move] of CHAT_MOVES.entries()) {
      expect(plans[index], move.from).toContain(`${move.from}_pkey`);
      expect(plans[index], move.from).toContain(
        `Index Cond: (id > COALESCE($1, ''::text))`,
      );
    }
  });

  test("a scheduled exchange names its task only when that can be told", async () => {
    const exchanges = await db.exchange.findMany({
      where: { origin: "schedule" },
      select: { id: true, scheduleId: true },
    });
    const surviving = [...seed.scheduled].filter(([id]) => !id.startsWith("seed-0-001-"));
    expect(exchanges.length).toBe(surviving.length);
    for (const exchange of exchanges) {
      expect([exchange.id, exchange.scheduleId]).toEqual([
        exchange.id,
        seed.scheduled.get(exchange.id) ?? null,
      ]);
    }
    expect(
      await db.exchange.count({ where: { origin: "person", NOT: { scheduleId: null } } }),
    ).toBe(0);
  });

  test("an orphaned copy stops the finish step and the move stays expanded", async () => {
    await db.$executeRawUnsafe(
      `INSERT INTO "exchanges" ("id", "conversation_id", "question_sealed") VALUES ('orphan', 'no-such-thread', 'x')`,
    );
    const attempt = await finishBackfill(db, log).then(
      () => "finished",
      () => "refused",
    );
    expect(attempt).toBe("refused");
    expect((await db.schemaMove.findUniqueOrThrow({ where: { move: MOVE } })).phase).toBe(
      "expanded",
    );
    await db.$executeRawUnsafe(`DELETE FROM "exchanges" WHERE "id" = 'orphan'`);
  });

  test("finishing adds the keys and the check, and marks the move backfilled", async () => {
    await finishBackfill(db, log);
    const names = await db.$queryRaw<{ name: string; valid: boolean }[]>`
      SELECT conname AS name, convalidated AS valid FROM pg_constraint
       WHERE conrelid::regclass::text IN ('conversations', 'exchanges', 'answers')
         AND contype IN ('f', 'c')`;
    expect(names.map((row) => row.name).sort()).toEqual(
      FINISH_CONSTRAINTS.map((constraint) => constraint.name).sort(),
    );
    expect(names.every((row) => row.valid)).toBe(true);
    expect((await db.schemaMove.findUniqueOrThrow({ where: { move: MOVE } })).phase).toBe(
      "backfilled",
    );
    // A second finish changes nothing.
    await finishBackfill(db, log);
  });

  test("after the finish, the mirror and the cascades still agree", async () => {
    await db.turn.create({
      data: { id: "seed-0-002-late", threadId: "seed-0-002", prompt: "late" },
    });
    await db.scheduledTask.delete({ where: { id: "task-alone" } });
    expect(
      await db.exchange.count({
        where: { conversationId: "seed-0-008", NOT: { scheduleId: null } },
      }),
    ).toBe(0);
    await db.thread.delete({ where: { id: "seed-0-002" } });
    await db.user.delete({ where: { id: SEED_USERS[1] } });
    expect(await differences()).toEqual(none);
    expect(await db.conversation.count({ where: { ownerId: SEED_USERS[1] } })).toBe(0);
  });

  test("the log names tables and counts only", () => {
    for (const line of lines) {
      expect(line).toMatch(/^[a-z_-]+: [\w ,]+$/);
    }
  });
});
