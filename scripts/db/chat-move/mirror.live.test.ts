import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { Prisma } from "@/generated/prisma/client";

import { liveDatabase, requireNoThreads, runLive } from "./live.test-helpers";

/**
 * The mirror triggers against a real Postgres, with made-up rows only:
 * inserts, updates and deletes on the old chat tables reach the new ones in
 * the same transaction, sealed text arrives byte for byte, and the schedule
 * of a scheduled exchange is filled when it can be told.
 *   RUN_LIVE=1 DATABASE_URL=<throwaway, migrated> bun test scripts/db/chat-move/mirror.live.test.ts
 */

const USER = "mirror-test-user";
/** Shaped like a sealed value; the triggers never open it. */
const SEALED = "tlenc1.k-test.AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";

describe.skipIf(!runLive)("chat mirror triggers (RUN_LIVE=1)", () => {
  const db = liveDatabase();

  const seedThread = async (id: string, turns: number) => {
    await db.thread.create({ data: { id, userId: USER, title: `${SEALED}.${id}` } });
    for (let n = 0; n < turns; n += 1) {
      await db.turn.create({
        data: { id: `${id}-turn-${n}`, threadId: id, prompt: `${SEALED}.p${n}` },
      });
      await db.modelResponse.create({
        data: {
          id: `${id}-answer-${n}`,
          turnId: `${id}-turn-${n}`,
          modelId: "made-up:model",
          modelName: "Made-up model",
          position: 0,
        },
      });
    }
  };

  /**
   * A stored time as epoch milliseconds, read in SQL: the Prisma adapter
   * reads timestamptz as if the session were UTC, so a Date it returns is
   * shifted on a server set to another zone.
   */
  const epochMs = async (table: string, id: string, column: string): Promise<number> => {
    const rows = await db.$queryRawUnsafe<{ ms: string }[]>(
      `SELECT (extract(epoch FROM "${column}") * 1000)::bigint::text AS ms FROM "${table}" WHERE "id" = $1`,
      id,
    );
    return Number(rows[0]?.ms);
  };

  const counts = async () => ({
    conversations: await db.conversation.count(),
    exchanges: await db.exchange.count(),
    answers: await db.answer.count(),
  });

  beforeAll(async () => {
    await requireNoThreads(db);
    await db.user.create({ data: { id: USER, clerkId: USER } });
  });
  afterEach(async () => {
    await db.scheduledTask.deleteMany({ where: { userId: USER } });
    await db.thread.deleteMany({ where: { userId: USER } });
  });
  afterAll(async () => {
    await db.user.deleteMany({ where: { id: USER } });
    await db.$disconnect();
  });

  test("a new thread, turn and answer are copied with their ids", async () => {
    await seedThread("t1", 1);
    const conversation = await db.conversation.findUniqueOrThrow({ where: { id: "t1" } });
    expect(conversation.ownerId).toBe(USER);
    expect(conversation.titleSealed).toBe(`${SEALED}.t1`);
    const exchange = await db.exchange.findUniqueOrThrow({ where: { id: "t1-turn-0" } });
    expect(exchange).toMatchObject({
      conversationId: "t1",
      questionSealed: `${SEALED}.p0`,
      bubbleTextSealed: null,
      origin: "person",
      scheduleId: null,
    });
    const answer = await db.answer.findUniqueOrThrow({ where: { id: "t1-answer-0" } });
    expect(answer).toMatchObject({
      exchangeId: "t1-turn-0",
      answererRef: "made-up:model",
      answererLabel: "Made-up model",
      columnIndex: 0,
      state: "streaming",
      bodySealed: "",
      closedAt: null,
    });
  });

  test("completing an answer copies its text, JSON columns and measurements exactly", async () => {
    await seedThread("t2", 1);
    const completedAt = new Date("2026-11-17T22:15:30.123Z");
    await db.modelResponse.update({
      where: { id: "t2-answer-0" },
      data: {
        status: "COMPLETE",
        text: `${SEALED}.body`,
        reasoningText: `${SEALED}.why`,
        attribution: `${SEALED}.cited`,
        responseDocument: `${SEALED}.doc`,
        toolParts: `${SEALED}.tools`,
        timeToFirstTokenMs: 412,
        tokensPerSecond: new Prisma.Decimal("0.01"),
        inputTokens: 1200,
        outputTokens: 0,
        totalTokens: 1200,
        costUsd: new Prisma.Decimal("9999.999999"),
        completedAt,
      },
    });
    const answer = await db.answer.findUniqueOrThrow({ where: { id: "t2-answer-0" } });
    expect(answer).toMatchObject({
      state: "complete",
      bodySealed: `${SEALED}.body`,
      reasoningSealed: `${SEALED}.why`,
      evidenceSealed: `${SEALED}.cited`,
      documentSealed: `${SEALED}.doc`,
      toolTraceSealed: `${SEALED}.tools`,
      firstTokenMs: 412,
      inputTokens: 1200,
      outputTokens: 0,
      totalTokens: 1200,
    });
    expect(await epochMs("answers", "t2-answer-0", "closed_at")).toBe(
      completedAt.getTime(),
    );
    expect(answer.tokensPerSecond?.toString()).toBe("0.01");
    expect(answer.costUsd.toString()).toBe("9999.999999");
  });

  test("every status maps to its state", async () => {
    await seedThread("t3", 1);
    for (const status of [
      "COMPLETE",
      "FAILED",
      "REFUSED",
      "STOPPED",
      "STREAMING",
    ] as const) {
      await db.modelResponse.update({ where: { id: "t3-answer-0" }, data: { status } });
      const answer = await db.answer.findUniqueOrThrow({ where: { id: "t3-answer-0" } });
      expect(answer.state).toBe(status.toLowerCase() as typeof answer.state);
    }
  });

  test("times keep their instant whatever the session's time zone", async () => {
    const createdAt = new Date("2026-03-29T01:30:00.250Z");
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL TIME ZONE 'Pacific/Auckland'`;
      await tx.thread.create({
        data: {
          id: "t4",
          userId: USER,
          title: "made-up",
          createdAt,
          updatedAt: createdAt,
        },
      });
    });
    expect(await epochMs("conversations", "t4", "started_at")).toBe(createdAt.getTime());
    expect(await epochMs("conversations", "t4", "last_activity_at")).toBe(
      createdAt.getTime(),
    );
  });

  test("deleting a thread removes its copies; deleting a turn removes its own", async () => {
    await seedThread("t5", 3);
    await seedThread("t6", 2);
    expect(await counts()).toEqual({ conversations: 2, exchanges: 5, answers: 5 });
    await db.turn.delete({ where: { id: "t6-turn-1" } });
    expect(await counts()).toEqual({ conversations: 2, exchanges: 4, answers: 4 });
    await db.thread.delete({ where: { id: "t5" } });
    expect(await counts()).toEqual({ conversations: 1, exchanges: 1, answers: 1 });
  });

  test("a write rolled back leaves no copy", async () => {
    const attempt = await db
      .$transaction(async (tx) => {
        await tx.thread.create({ data: { id: "t7", userId: USER, title: "made-up" } });
        throw new Error("roll back");
      })
      .then(
        () => "committed",
        () => "rolled back",
      );
    expect(attempt).toBe("rolled back");
    expect(await db.conversation.count({ where: { id: "t7" } })).toBe(0);
  });

  test("a scheduled turn names its task when one task targets the thread", async () => {
    await seedThread("t8", 0);
    await db.scheduledTask.create({
      data: {
        id: "task-a",
        userId: USER,
        threadId: "t8",
        skill: "sleep",
        question: "made-up",
        modelId: "made-up:model",
        scheduleKind: "daily",
        timeZone: "UTC",
      },
    });
    await db.turn.create({
      data: { id: "t8-run", threadId: "t8", prompt: "made-up", scheduled: true },
    });
    expect(
      await db.exchange.findUniqueOrThrow({ where: { id: "t8-run" } }),
    ).toMatchObject({
      origin: "schedule",
      scheduleId: "task-a",
    });
  });

  test("two tasks on one thread leave the guess empty until a run names its turn", async () => {
    await seedThread("t9", 0);
    const task = (id: string) => ({
      id,
      userId: USER,
      threadId: "t9",
      skill: "sleep",
      question: "made-up",
      modelId: "made-up:model",
      scheduleKind: "daily",
      timeZone: "UTC",
    });
    await db.scheduledTask.createMany({ data: [task("task-b"), task("task-c")] });
    await db.turn.create({
      data: { id: "t9-run", threadId: "t9", prompt: "made-up", scheduled: true },
    });
    expect(
      (await db.exchange.findUniqueOrThrow({ where: { id: "t9-run" } })).scheduleId,
    ).toBe(null);
    await db.scheduledTask.update({
      where: { id: "task-c" },
      data: { lastTurnId: "t9-run" },
    });
    expect(
      (await db.exchange.findUniqueOrThrow({ where: { id: "t9-run" } })).scheduleId,
    ).toBe("task-c");
  });

  test("a person's turn never gets a schedule, even when a task names it", async () => {
    await seedThread("t10", 1);
    await db.scheduledTask.create({
      data: {
        id: "task-d",
        userId: USER,
        threadId: "t10",
        skill: "sleep",
        question: "made-up",
        modelId: "made-up:model",
        scheduleKind: "daily",
        timeZone: "UTC",
        lastTurnId: "t10-turn-0",
      },
    });
    expect(
      await db.exchange.findUniqueOrThrow({ where: { id: "t10-turn-0" } }),
    ).toMatchObject({
      origin: "person",
      scheduleId: null,
    });
  });

  test("deleting a task clears the schedule but keeps the exchange and its origin", async () => {
    await seedThread("t11", 0);
    await db.scheduledTask.create({
      data: {
        id: "task-e",
        userId: USER,
        skill: "sleep",
        question: "made-up",
        modelId: "made-up:model",
        scheduleKind: "daily",
        timeZone: "UTC",
      },
    });
    await db.turn.create({
      data: { id: "t11-run", threadId: "t11", prompt: "made-up", scheduled: true },
    });
    await db.scheduledTask.update({
      where: { id: "task-e" },
      data: { lastTurnId: "t11-run", threadId: "t11" },
    });
    expect(
      (await db.exchange.findUniqueOrThrow({ where: { id: "t11-run" } })).scheduleId,
    ).toBe("task-e");
    await db.scheduledTask.delete({ where: { id: "task-e" } });
    expect(
      await db.exchange.findUniqueOrThrow({ where: { id: "t11-run" } }),
    ).toMatchObject({
      origin: "schedule",
      scheduleId: null,
    });
  });

  test("deleting the person removes every copy of their chats", async () => {
    const other = "mirror-test-user-2";
    await db.user.create({ data: { id: other, clerkId: other } });
    await db.thread.create({ data: { id: "t12", userId: other, title: "made-up" } });
    await db.turn.create({
      data: { id: "t12-turn", threadId: "t12", prompt: "made-up" },
    });
    expect(await db.exchange.count({ where: { conversationId: "t12" } })).toBe(1);
    await db.user.delete({ where: { id: other } });
    expect(await db.conversation.count({ where: { ownerId: other } })).toBe(0);
    expect(await db.exchange.count({ where: { conversationId: "t12" } })).toBe(0);
  });
});
