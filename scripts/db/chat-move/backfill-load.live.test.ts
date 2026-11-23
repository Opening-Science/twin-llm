import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { finishBackfill, runBackfill } from "./backfill";
import { UNDO_FINISH_SQL } from "./backfill-sql";
import { liveDatabase, requireNoThreads, runLive } from "./live.test-helpers";
import { checkParity } from "./parity";
import { clearSeed, SEED_USERS, seedOldChats } from "./seed.test-helpers";

/**
 * The backfill while the app keeps writing (DATA-MODEL.md D.3), with
 * made-up rows only. A writer on its own connections adds turns, completes
 * and stops answers, deletes threads and releases interrupted runs, without
 * pause, while the backfill runs: first stopped halfway, then to the end,
 * then the finish step and the parity gate. After the writer stops, a third
 * run inserts nothing and the gate passes again.
 *   RUN_LIVE=1 DATABASE_URL=<throwaway, migrated> bun test scripts/db/chat-move/backfill-load.live.test.ts
 */

describe.skipIf(!runLive)("chat backfill under load (RUN_LIVE=1)", () => {
  const db = liveDatabase();
  const writerDb = liveDatabase();
  const log = () => undefined;
  let writing = true;
  let writes = 0;

  /** One step of the made-up app, picked by the step number. */
  const writeStep = async (n: number): Promise<void> => {
    const user = SEED_USERS[n % 2] ?? SEED_USERS[0];
    const thread = `seed-${n % 2}-${String(n % 20).padStart(3, "0")}`;
    switch (n % 5) {
      case 0: {
        const id = `load-${n}`;
        await writerDb.thread.create({ data: { id, userId: user, title: `Load ${n}` } });
        await writerDb.turn.create({
          data: { id: `${id}-q`, threadId: id, prompt: "made-up" },
        });
        await writerDb.modelResponse.create({
          data: { id: `${id}-q-a`, turnId: `${id}-q`, modelId: "m", modelName: "M" },
        });
        return;
      }
      case 1: {
        // A follow-up turn on an old thread, if it is still there.
        const exists = await writerDb.thread.count({ where: { id: thread } });
        if (exists === 0) return;
        await writerDb.thread.update({
          where: { id: thread },
          data: { updatedAt: new Date() },
        });
        await writerDb.turn.create({
          data: { id: `load-${n}-q`, threadId: thread, prompt: "follow-up" },
        });
        return;
      }
      case 2:
        await writerDb.modelResponse.updateMany({
          where: { status: "STREAMING", turn: { threadId: thread } },
          data: { status: "COMPLETE", text: `done ${n}`, completedAt: new Date() },
        });
        return;
      case 3:
        await writerDb.modelResponse.updateMany({
          where: { status: "COMPLETE", turn: { threadId: thread } },
          data: { status: "STOPPED" },
        });
        return;
      default:
        if (n % 15 === 4) {
          await writerDb.thread.deleteMany({ where: { id: thread } });
        } else {
          // What the server start does with interrupted scheduled runs.
          await writerDb.modelResponse.updateMany({
            where: { status: "STREAMING", turn: { scheduled: true } },
            data: { status: "FAILED", completedAt: new Date() },
          });
        }
    }
  };

  /** Two people's sessions writing at once, each its own sequence of steps. */
  const writer = async (): Promise<void> => {
    const session = async (offset: number) => {
      for (let n = offset; writing; n += 2) {
        await writeStep(n);
        writes += 1;
      }
    };
    await Promise.all([session(0), session(1)]);
  };

  beforeAll(async () => {
    await requireNoThreads(db);
    await seedOldChats(db, 20);
  });
  afterAll(async () => {
    writing = false;
    await clearSeed(db, UNDO_FINISH_SQL);
    await writerDb.$disconnect();
    await db.$disconnect();
  });

  // Up to a minute: two writers and three backfill runs on a busy machine.
  test("a stopped run and a full run alongside a busy writer lose nothing", async () => {
    const running = writer();
    const stopped = await runBackfill(db, { batchSize: 5, maxBatches: 12, log });
    expect(stopped.complete).toBe(false);
    const full = await runBackfill(db, { batchSize: 5, log });
    expect(full.complete).toBe(true);
    // As on the live database: the keys are added and the gate runs while
    // people keep writing.
    await finishBackfill(db, log);
    const during = await checkParity(db);
    writing = false;
    await running;
    // About 200 on a laptop; enough that batches and writes interleave.
    expect(writes).toBeGreaterThan(20);
    const third = await runBackfill(db, { batchSize: 1000, log });
    expect(third.tables.map((table) => table.inserted)).toEqual([0, 0, 0]);
    const after = await checkParity(db);
    for (const report of [during, after]) {
      expect(
        report.tables.map((table) => [
          table.table,
          table.missing,
          table.extra,
          table.differing,
        ]),
      ).toEqual([
        ["conversations", 0, 0, 0],
        ["exchanges", 0, 0, 0],
        ["answers", 0, 0, 0],
      ]);
      expect(report.ok).toBe(true);
    }
  }, 60_000);
});
