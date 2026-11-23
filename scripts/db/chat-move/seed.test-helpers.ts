import { Prisma, type PrismaClient } from "@/generated/prisma/client";

/**
 * Made-up chat rows shaped like the ones production writes, for the
 * backfill and parity live tests (DATA-MODEL.md D.1). Written with the
 * mirror triggers switched off, so they stand for rows older than the
 * expand step. Every value is invented.
 */

export const SEED_USERS = ["move-seed-a", "move-seed-b"] as const;

/** Shaped like a sealed value; nothing here opens it. */
const sealedLike = (n: number): string =>
  `tlenc1.k-made-up.${Buffer.from(`made-up ${n}`).toString("base64")}`;

const TITLES = [
  "Sleep last week",
  "Two lines\nin one title",
  "Resting heart rate 🫀 and runs",
  "x".repeat(80),
  "/twin how is my day",
];

const STATUSES = ["STREAMING", "COMPLETE", "FAILED", "REFUSED", "STOPPED"] as const;
const COSTS = ["0", "0.000001", "9999.999999", "0.42"];

export type SeedShape = Readonly<{
  threads: number;
  turns: number;
  answers: number;
  /** Scheduled turn ids and the task the backfill must name (null when it cannot tell). */
  scheduled: ReadonlyMap<string, string | null>;
}>;

const MIRRORED = ["threads", "turns", "model_responses", "scheduled_tasks"] as const;

/** Runs `write` with the mirror triggers off, as if before the expand step. */
export const withoutMirror = async (
  db: PrismaClient,
  write: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<void> =>
  db.$transaction(
    async (tx) => {
      for (const table of MIRRORED) {
        await tx.$executeRawUnsafe(
          `ALTER TABLE "${table}" DISABLE TRIGGER "chat_move_mirror"`,
        );
      }
      await write(tx);
      for (const table of MIRRORED) {
        await tx.$executeRawUnsafe(
          `ALTER TABLE "${table}" ENABLE TRIGGER "chat_move_mirror"`,
        );
      }
    },
    { timeout: 60_000 },
  );

const task = (
  id: string,
  userId: string,
  threadId: string | null,
  lastTurnId: string | null,
) => ({
  id,
  userId,
  threadId,
  lastTurnId,
  skill: "sleep",
  question: sealedLike(9000),
  modelId: "made-up:model",
  scheduleKind: "daily",
  timeZone: "Europe/Zurich",
});

/** Seeds both users' chats with the triggers off; returns what was written. */
export const seedOldChats = async (
  db: PrismaClient,
  threadsPerUser: number,
): Promise<SeedShape> => {
  let threads = 0;
  let turns = 0;
  let answers = 0;
  const scheduled = new Map<string, string | null>();
  await withoutMirror(db, async (tx) => {
    for (const [u, userId] of SEED_USERS.entries()) {
      await tx.user.create({ data: { id: userId, clerkId: userId } });
      for (let t = 0; t < threadsPerUser; t += 1) {
        const threadId = `seed-${u}-${String(t).padStart(3, "0")}`;
        const at = new Date(Date.UTC(2026, 9, 1 + t, 6 + u, 30, 0, 125));
        await tx.thread.create({
          data: {
            id: threadId,
            userId,
            title: t % 2 === 0 ? sealedLike(t) : (TITLES[t % TITLES.length] ?? "made-up"),
            createdAt: at,
            updatedAt: new Date(at.getTime() + 3_600_000),
          },
        });
        threads += 1;
        const turnCount = 1 + (t % 6);
        for (let n = 0; n < turnCount; n += 1) {
          const turnId = `${threadId}-q${n}`;
          const isScheduled = t % 5 === 3 && n > 0;
          await tx.turn.create({
            data: {
              id: turnId,
              threadId,
              prompt:
                n % 2 === 0
                  ? sealedLike(100 * t + n)
                  : `Question ${n} about made-up data`,
              createdAt: new Date(at.getTime() + n * 60_000),
              scheduled: isScheduled,
              skill: n % 3 === 1 ? "sleep" : null,
              label: n % 4 === 2 ? sealedLike(200 * t + n) : null,
            },
          });
          turns += 1;
          const answerCount = 1 + ((t + n) % 3);
          for (let a = 0; a < answerCount; a += 1) {
            const status =
              isScheduled && a === 0 ? "STREAMING" : STATUSES[(t + n + a) % 5];
            const done = status !== "STREAMING";
            await tx.modelResponse.create({
              data: {
                id: `${turnId}-a${a}`,
                turnId,
                modelId: a === 2 ? "agent:made-up" : `made-up:model-${a}`,
                modelName: `Made-up model ${a}`,
                status: status ?? "COMPLETE",
                text: done ? sealedLike(300 * t + 10 * n + a) : "",
                position: t % 4 === 0 ? null : a,
                reasoningText: a === 1 ? sealedLike(400 * t + n) : null,
                attribution: a === 0 && done ? sealedLike(500 * t + n) : null,
                responseDocument: a === 0 && done ? `{"version":1,"blocks":[]}` : null,
                toolParts: a === 1 && done ? sealedLike(600 * t + n) : null,
                timeToFirstTokenMs: done ? 100 + t : null,
                tokensPerSecond: done
                  ? new Prisma.Decimal(a === 2 ? "0.01" : "42.50")
                  : null,
                inputTokens: done ? 1000 + n : null,
                outputTokens: done ? 0 : null,
                totalTokens: done ? 1000 + n : null,
                costUsd: new Prisma.Decimal(COSTS[(t + a) % COSTS.length] ?? "0"),
                createdAt: new Date(at.getTime() + n * 60_000 + 500),
                completedAt: done ? new Date(at.getTime() + n * 60_000 + 9_999) : null,
              },
            });
            answers += 1;
          }
          if (isScheduled) scheduled.set(turnId, null);
        }
      }
    }
    // Tasks, user a: one named by last_turn_id, one alone on its thread,
    // two sharing a thread, one whose last turn was deleted, one never run.
    const a = SEED_USERS[0];
    await tx.scheduledTask.createMany({
      data: [
        task("task-named", a, "seed-0-003", "seed-0-003-q2"),
        task("task-alone", a, "seed-0-008", null),
        task("task-shared-1", a, "seed-0-013", null),
        task("task-shared-2", a, "seed-0-013", null),
        task("task-lost-turn", a, null, "seed-gone-turn"),
        task("task-never-run", a, null, null),
      ],
    });
  });
  for (const turnId of scheduled.keys()) {
    // q2 by last_turn_id; q1 and q3 because task-named is the thread's only task.
    if (turnId.startsWith("seed-0-003-")) scheduled.set(turnId, "task-named");
    else if (turnId.startsWith("seed-0-008-")) scheduled.set(turnId, "task-alone");
  }
  return { threads, turns, answers, scheduled };
};

/** Removes everything the seed and the tests wrote, copies included. */
export const clearSeed = async (
  db: PrismaClient,
  undo: readonly string[],
): Promise<void> => {
  for (const statement of undo) await db.$executeRawUnsafe(statement);
  await db.user.deleteMany({ where: { id: { in: [...SEED_USERS] } } });
  await db.$executeRawUnsafe(`DELETE FROM "answers"`);
  await db.$executeRawUnsafe(`DELETE FROM "exchanges"`);
  await db.$executeRawUnsafe(`DELETE FROM "conversations"`);
};
