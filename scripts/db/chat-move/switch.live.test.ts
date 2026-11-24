import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { Prisma } from "@/generated/prisma/client";
import { openChatText, sealChatText } from "@/infrastructure/chat-seal-contexts";
import { sealedCipher } from "@/infrastructure/field-cipher";
import { keyPrefix, personalTable } from "@/infrastructure/personal-columns";
import { type ResealPorts, resealTable, type SqlRun } from "@/infrastructure/reseal";

import { asSwitched, liveDatabase, requireNoThreads, runLive } from "./live.test-helpers";
import { checkParity } from "./parity";
import { runSwitchBack } from "./switch-back";
import { SWITCH_MIGRATION } from "./switch-sql";

/**
 * The switch of the chat tables move against a real Postgres, with made-up
 * rows only (DATA-MODEL.md C.4): the app's writes to conversations,
 * exchanges and answers reach threads, turns and model_responses through the
 * reverse triggers; the repointed keys cascade from conversations; the
 * switch refuses copies that differ; switching back keeps every write made
 * after the switch and hands over to the mirror triggers; switching again
 * carries on. A reseal of the new tables reaches the old copies.
 *   RUN_LIVE=1 DATABASE_URL=<throwaway, migrated> bun test scripts/db/chat-move/switch.live.test.ts
 */

const USER = "switch-live-user";
const ACTIVE = { keyId: "c3c3c3c3c3c3c3c3", dataKey: Buffer.alloc(32, 33) };
const RETIRED = { keyId: "d4d4d4d4d4d4d4d4", dataKey: Buffer.alloc(32, 44) };
const keyring = sealedCipher(ACTIVE, [RETIRED]);
const retiredOnly = sealedCipher(RETIRED);

const TRIGGERS_SQL = `SELECT
  (SELECT string_agg(c.relname, ',' ORDER BY c.relname) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE t.tgname = 'chat_move_reverse') AS reverse,
  (SELECT string_agg(c.relname, ',' ORDER BY c.relname) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE t.tgname = 'chat_move_mirror') AS mirror,
  (SELECT string_agg(conname || '>' || confrelid::regclass::text, ',' ORDER BY conname) FROM pg_constraint
    WHERE conname IN ('scheduled_tasks_thread_id_fkey', 'thread_search_embeddings_thread_id_fkey')) AS keys`;

type Triggers = { reverse: string | null; mirror: string | null; keys: string | null };

describe.skipIf(!runLive)("chat tables switch (RUN_LIVE=1)", () => {
  const db = liveDatabase();

  const phase = async (): Promise<string> =>
    (await db.schemaMove.findUniqueOrThrow({ where: { move: "chat-tables" } })).phase;

  const triggers = async (): Promise<Triggers | undefined> =>
    (await db.$queryRawUnsafe<Triggers[]>(TRIGGERS_SQL))[0];

  /** A conversation with one exchange and one streaming answer, written as turn-writer writes it. */
  const writeConversation = async (id: string, scheduleId: string | null = null) => {
    await db.conversation.create({
      data: {
        id,
        ownerId: USER,
        titleSealed: sealChatText(
          keyring,
          "conversations",
          "title_sealed",
          id,
          "Made-up 🫀",
        ),
        exchanges: {
          create: {
            id: `${id}-q`,
            questionSealed: sealChatText(
              keyring,
              "exchanges",
              "question_sealed",
              `${id}-q`,
              "Made-up question",
            ),
            bubbleTextSealed: null,
            skillName: "sleep",
            origin: scheduleId === null ? "person" : "schedule",
            scheduleId,
            answers: {
              create: {
                id: `${id}-a`,
                answererRef: "made-up:model",
                answererLabel: "Made-up model",
                columnIndex: 0,
                bodySealed: sealChatText(
                  keyring,
                  "answers",
                  "body_sealed",
                  `${id}-a`,
                  "",
                ),
              },
            },
          },
        },
      },
    });
  };

  /** The switch migration's row; a switch back forgets it and db:deploy writes it again. */
  const saved: { migration: Record<string, unknown> | null } = { migration: null };

  /** Switches again as `bun run db:deploy` would: the switch, then the migration's row. */
  const deployAgain = async (): Promise<void> => {
    await asSwitched(db);
    const row = saved.migration;
    if (row === null) throw new Error("no switch migration row saved");
    await db.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
       SELECT $1::text, $2::text, $3::timestamptz, $4::text, $5::text, $6::timestamptz, $7::timestamptz, $8::int
        WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" = $4::text)`,
      row.id,
      row.checksum,
      row.finished_at,
      row.migration_name,
      row.logs,
      row.rolled_back_at,
      row.started_at,
      row.applied_steps_count,
    );
  };

  beforeAll(async () => {
    await requireNoThreads(db);
    const [row] = await db.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT * FROM "_prisma_migrations" WHERE "migration_name" = $1`,
      SWITCH_MIGRATION,
    );
    saved.migration = row ?? null;
    await db.user.create({ data: { id: USER, clerkId: USER } });
  });
  afterAll(async () => {
    await db.user.deleteMany({ where: { id: USER } });
    await deployAgain();
    await db.$disconnect();
  });

  test("the migrated database is switched: reverse triggers, no mirror, keys on conversations", async () => {
    expect(await phase()).toBe("switched");
    expect(await triggers()).toEqual({
      reverse: "answers,conversations,exchanges",
      mirror: null,
      keys: "scheduled_tasks_thread_id_fkey>conversations,thread_search_embeddings_thread_id_fkey>conversations",
    });
  });

  test("a conversation written the app's way reaches the old tables, sealed values byte for byte", async () => {
    await writeConversation("switch-write");
    const thread = await db.thread.findUniqueOrThrow({ where: { id: "switch-write" } });
    const conversation = await db.conversation.findUniqueOrThrow({
      where: { id: "switch-write" },
    });
    expect(thread.title).toBe(conversation.titleSealed);
    // The old read path opens the copy under the frozen name.
    expect(keyring.openText("threads", "title", thread.id, thread.title)).toBe(
      "Made-up 🫀",
    );
    const turn = await db.turn.findUniqueOrThrow({ where: { id: "switch-write-q" } });
    expect({ scheduled: turn.scheduled, skill: turn.skill, label: turn.label }).toEqual({
      scheduled: false,
      skill: "sleep",
      label: null,
    });
    const old = await db.modelResponse.findUniqueOrThrow({
      where: { id: "switch-write-a" },
    });
    expect({ status: old.status, position: old.position, modelId: old.modelId }).toEqual({
      status: "STREAMING",
      position: 0,
      modelId: "made-up:model",
    });
    expect((await checkParity(db)).ok).toBe(true);
  });

  test("finishing an answer copies every column, and each state has its status", async () => {
    const closedAt = new Date("2026-10-25T01:30:00.123Z");
    for (const [state, status] of [
      ["complete", "COMPLETE"],
      ["failed", "FAILED"],
      ["refused", "REFUSED"],
      ["stopped", "STOPPED"],
      ["streaming", "STREAMING"],
    ] as const) {
      await db.answer.update({
        where: { id: "switch-write-a" },
        data: {
          state,
          bodySealed: sealChatText(
            keyring,
            "answers",
            "body_sealed",
            "switch-write-a",
            state,
          ),
          reasoningSealed: "r",
          evidenceSealed: "e",
          documentSealed: "d",
          toolTraceSealed: "t",
          firstTokenMs: 123,
          tokensPerSecond: new Prisma.Decimal("0.01"),
          inputTokens: 1,
          outputTokens: 0,
          totalTokens: 1,
          costUsd: new Prisma.Decimal("9999.999999"),
          closedAt,
        },
      });
      const old = await db.modelResponse.findUniqueOrThrow({
        where: { id: "switch-write-a" },
      });
      expect(old.status).toBe(status);
      expect(keyring.openText("model_responses", "text", old.id, old.text)).toBe(state);
      expect({
        reasoning: old.reasoningText,
        evidence: old.attribution,
        document: old.responseDocument,
        tools: old.toolParts,
        ttft: old.timeToFirstTokenMs,
        tps: old.tokensPerSecond?.toString(),
        cost: old.costUsd.toString(),
        at: old.completedAt?.toISOString(),
      }).toEqual({
        reasoning: "r",
        evidence: "e",
        document: "d",
        tools: "t",
        ttft: 123,
        tps: "0.01",
        cost: "9999.999999",
        at: closedAt.toISOString(),
      });
    }
    expect((await checkParity(db)).ok).toBe(true);
  });

  test("deleting a conversation removes its old rows, its tasks and its search vectors", async () => {
    await writeConversation("switch-delete");
    await db.scheduledTask.create({
      data: {
        id: "switch-delete-task",
        userId: USER,
        threadId: "switch-delete",
        skill: "sleep",
        question: "made-up",
        modelId: "made-up:model",
        scheduleKind: "daily",
        timeZone: "Europe/Zurich",
      },
    });
    await db.$executeRawUnsafe(
      `INSERT INTO "thread_search_embeddings" ("id", "user_id", "thread_id", "source_kind", "source_id", "model")
       VALUES ('switch-delete-vector', $1, 'switch-delete', 'prompt', 'switch-delete-q', 'made-up')`,
      USER,
    );
    await db.conversation.delete({ where: { id: "switch-delete" } });
    expect({
      threads: await db.thread.count({ where: { id: "switch-delete" } }),
      turns: await db.turn.count({ where: { id: "switch-delete-q" } }),
      answers: await db.modelResponse.count({ where: { id: "switch-delete-a" } }),
      tasks: await db.scheduledTask.count({ where: { id: "switch-delete-task" } }),
      vectors: await db.threadSearchEmbedding.count({
        where: { id: "switch-delete-vector" },
      }),
    }).toEqual({ threads: 0, turns: 0, answers: 0, tasks: 0, vectors: 0 });
  });

  test("a scheduled exchange names its task; deleting the task keeps the exchange and its origin", async () => {
    await db.scheduledTask.create({
      data: {
        id: "switch-task",
        userId: USER,
        skill: "sleep",
        question: "made-up",
        modelId: "made-up:model",
        scheduleKind: "daily",
        timeZone: "Europe/Zurich",
      },
    });
    await writeConversation("switch-scheduled", "switch-task");
    expect(
      (await db.turn.findUniqueOrThrow({ where: { id: "switch-scheduled-q" } }))
        .scheduled,
    ).toBe(true);
    await db.scheduledTask.delete({ where: { id: "switch-task" } });
    const exchange = await db.exchange.findUniqueOrThrow({
      where: { id: "switch-scheduled-q" },
    });
    expect({ origin: exchange.origin, scheduleId: exchange.scheduleId }).toEqual({
      origin: "schedule",
      scheduleId: null,
    });
    expect(
      (await db.turn.findUniqueOrThrow({ where: { id: "switch-scheduled-q" } }))
        .scheduled,
    ).toBe(true);
    expect((await checkParity(db)).ok).toBe(true);
  });

  test("switching back keeps every write since the switch, and the old write path works again", async () => {
    expect(saved.migration).not.toBeNull();
    await writeConversation("switch-before-back");
    await runSwitchBack(db);

    expect(await phase()).toBe("backfilled");
    expect(await triggers()).toEqual({
      reverse: null,
      mirror: "model_responses,scheduled_tasks,threads,turns",
      keys: "scheduled_tasks_thread_id_fkey>threads,thread_search_embeddings_thread_id_fkey>threads",
    });
    const forgotten = await db.$queryRawUnsafe<unknown[]>(
      `SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" = $1`,
      SWITCH_MIGRATION,
    );
    expect(forgotten).toHaveLength(0);
    // Everything written after the switch is in the old tables.
    expect(await db.thread.count({ where: { userId: USER } })).toBe(
      await db.conversation.count({ where: { ownerId: USER } }),
    );
    expect((await checkParity(db)).ok).toBe(true);
    // The release before the switch writes threads; the mirror copies it.
    await db.thread.create({
      data: {
        id: "switch-after-back",
        userId: USER,
        title: "made-up",
        turns: {
          create: {
            id: "switch-after-back-q",
            prompt: "made-up",
            responses: {
              create: { id: "switch-after-back-a", modelId: "m", modelName: "M" },
            },
          },
        },
      },
    });
    expect(await db.answer.count({ where: { id: "switch-after-back-a" } })).toBe(1);
    expect((await checkParity(db)).ok).toBe(true);

    await deployAgain();
    expect(await phase()).toBe("switched");
    await writeConversation("switch-again");
    expect(await db.modelResponse.count({ where: { id: "switch-again-a" } })).toBe(1);
    expect((await checkParity(db)).ok).toBe(true);
  });

  test("the switch refuses a copy that differs and changes nothing", async () => {
    await runSwitchBack(db);
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `ALTER TABLE "threads" DISABLE TRIGGER "chat_move_mirror"`,
      );
      await tx.$executeRawUnsafe(
        `UPDATE "threads" SET "title" = 'changed' WHERE "id" = 'switch-write'`,
      );
      await tx.$executeRawUnsafe(
        `ALTER TABLE "threads" ENABLE TRIGGER "chat_move_mirror"`,
      );
    });
    const refused = await asSwitched(db).then(
      () => "switched",
      () => "refused",
    );
    expect(refused).toBe("refused");
    expect(await phase()).toBe("backfilled");
    expect((await triggers())?.reverse).toBeNull();

    // Repaired (the next mirror write copies the old row), it switches.
    await db.$executeRawUnsafe(
      `UPDATE "threads" SET "title" = (SELECT "title_sealed" FROM "conversations" WHERE "id" = 'switch-write') WHERE "id" = 'switch-write'`,
    );
    await deployAgain();
    expect(await phase()).toBe("switched");
  });

  test("a reseal of the new tables reaches the old copies, under the frozen names", async () => {
    await db.conversation.create({
      data: {
        id: "switch-reseal",
        ownerId: USER,
        titleSealed: sealChatText(
          retiredOnly,
          "conversations",
          "title_sealed",
          "switch-reseal",
          "Sealed before a rotation",
        ),
      },
    });
    const run: SqlRun = async (sql, params) =>
      db.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...params);
    const ports: ResealPorts = {
      query: run,
      transaction: (work) =>
        db.$transaction((tx) =>
          work(async (sql, params) =>
            tx.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...params),
          ),
        ),
    };
    const written = await resealTable(
      ports,
      keyring,
      personalTable("conversations"),
      USER,
    );
    expect(written).toBeGreaterThan(0);
    const conversation = await db.conversation.findUniqueOrThrow({
      where: { id: "switch-reseal" },
    });
    const thread = await db.thread.findUniqueOrThrow({ where: { id: "switch-reseal" } });
    expect(conversation.titleSealed.startsWith(keyPrefix(ACTIVE.keyId))).toBe(true);
    expect(thread.title).toBe(conversation.titleSealed);
    expect(
      openChatText(keyring, "conversations", "title_sealed", thread.id, thread.title),
    ).toBe("Sealed before a rotation");
    expect((await checkParity(db)).ok).toBe(true);
  });
});
