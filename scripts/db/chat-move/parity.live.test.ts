import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  type FieldCipher,
  plainCipher,
  sealedCipher,
} from "@/infrastructure/field-cipher";

import { finishBackfill, runBackfill } from "./backfill";
import { UNDO_FINISH_SQL } from "./backfill-sql";
import { liveDatabase, requireNoThreads, runLive } from "./live.test-helpers";
import { checkParity, openProblems, reportLines } from "./parity";
import { withoutMirror } from "./seed.test-helpers";

/**
 * The parity gate against a real Postgres, with made-up rows only: one
 * person's rows sealed under a test keyring of two keys (some under the
 * retired one, as after a rotation), one person's rows plain. The gate
 * fails before the backfill, passes after it, every sealed copy opens under
 * its frozen context to the same text, and one changed byte, one lost copy
 * or one orphan is caught.
 *   RUN_LIVE=1 DATABASE_URL=<throwaway, migrated> bun test scripts/db/chat-move/parity.live.test.ts
 */

const SEALED_USER = "parity-sealed";
const PLAIN_USER = "parity-plain";
const ACTIVE = { keyId: "a1a1a1a1a1a1a1a1", dataKey: Buffer.alloc(32, 11) };
const RETIRED = { keyId: "b2b2b2b2b2b2b2b2", dataKey: Buffer.alloc(32, 22) };
const keyring = sealedCipher(ACTIVE, [RETIRED]);
const retiredOnly = sealedCipher(RETIRED);

const cipherOf = (ownerId: string): FieldCipher | null =>
  ownerId === SEALED_USER ? keyring : ownerId === PLAIN_USER ? plainCipher : null;

describe.skipIf(!runLive)("chat parity gate (RUN_LIVE=1)", () => {
  const db = liveDatabase();
  const log = () => undefined;

  beforeAll(async () => {
    await requireNoThreads(db);
    await withoutMirror(db, async (tx) => {
      for (const [userId, sealing] of [
        [SEALED_USER, true],
        [PLAIN_USER, false],
      ] as const) {
        await tx.user.create({ data: { id: userId, clerkId: userId } });
        for (let t = 0; t < 4; t += 1) {
          // Half of the sealed person's rows were written before a rotation.
          const cipher = !sealing ? plainCipher : t % 2 === 0 ? keyring : retiredOnly;
          const threadId = `${userId}-${t}`;
          await tx.thread.create({
            data: {
              id: threadId,
              userId,
              title: cipher.sealText(
                "threads",
                "title",
                threadId,
                `Made-up title ${t} 🫀`,
              ),
            },
          });
          const turnId = `${threadId}-q`;
          await tx.turn.create({
            data: {
              id: turnId,
              threadId,
              prompt: cipher.sealText(
                "turns",
                "prompt",
                turnId,
                `Made-up question ${t}?`,
              ),
              label: t === 1 ? cipher.sealText("turns", "label", turnId, "Short") : null,
            },
          });
          const answerId = `${turnId}-a`;
          await tx.modelResponse.create({
            data: {
              id: answerId,
              turnId,
              modelId: "made-up:model",
              modelName: "Made-up model",
              status: "COMPLETE",
              text: cipher.sealText(
                "model_responses",
                "text",
                answerId,
                `Made-up answer ${t}`,
              ),
              reasoningText: cipher.sealText(
                "model_responses",
                "reasoningText",
                answerId,
                "Why",
              ),
              attribution: cipher.sealText(
                "model_responses",
                "attribution",
                answerId,
                "[]",
              ),
              responseDocument: cipher.sealText(
                "model_responses",
                "responseDocument",
                answerId,
                `{"version":1}`,
              ),
              toolParts:
                t === 2
                  ? null
                  : cipher.sealText("model_responses", "toolParts", answerId, "[]"),
            },
          });
        }
      }
    });
  });
  afterAll(async () => {
    for (const statement of UNDO_FINISH_SQL) await db.$executeRawUnsafe(statement);
    await db.user.deleteMany({ where: { id: { in: [SEALED_USER, PLAIN_USER] } } });
    await db.$executeRawUnsafe(`DELETE FROM "answers"`);
    await db.$executeRawUnsafe(`DELETE FROM "exchanges"`);
    await db.$executeRawUnsafe(`DELETE FROM "conversations"`);
    await db.$disconnect();
  });

  test("before the backfill the gate fails and counts what is missing", async () => {
    const report = await checkParity(db);
    expect(report.ok).toBe(false);
    expect(report.tables.map((table) => [table.table, table.missing])).toEqual([
      ["conversations", 8],
      ["exchanges", 8],
      ["answers", 8],
    ]);
  });

  test("after the backfill the gate passes", async () => {
    await runBackfill(db, { batchSize: 3, log });
    await finishBackfill(db, log);
    const report = await checkParity(db);
    expect(reportLines(report)).toContain("parity OK");
    expect(report.tables.map((table) => table.newRows)).toEqual([8, 8, 8]);
  });

  test("every sealed copy opens under its frozen context to the same text", async () => {
    expect(await openProblems(db, cipherOf)).toEqual({});
  });

  test("one changed byte in a sealed copy is caught by both checks", async () => {
    const [row] = await db.$queryRaw<{ body: string }[]>`
      SELECT "body_sealed" AS body FROM "answers" WHERE "id" = ${`${SEALED_USER}-1-q-a`}`;
    const body = row?.body ?? "";
    // A character well inside the envelope, so its bits are never padding.
    const at = Math.floor(body.length * 0.6);
    const changed = `${body.slice(0, at)}${body[at] === "A" ? "B" : "A"}${body.slice(at + 1)}`;
    await db.answer.update({
      where: { id: `${SEALED_USER}-1-q-a` },
      data: { bodySealed: changed },
    });
    const report = await checkParity(db);
    expect(report.ok).toBe(false);
    expect(report.tables.find((table) => table.table === "answers")?.differing).toBe(1);
    expect(await openProblems(db, cipherOf)).toEqual({ "answers.body_sealed": 1 });
    await db.answer.update({
      where: { id: `${SEALED_USER}-1-q-a` },
      data: { bodySealed: body },
    });
    expect((await checkParity(db)).ok).toBe(true);
  });

  test("a lost copy is counted as missing", async () => {
    await db.exchange.delete({ where: { id: `${PLAIN_USER}-3-q` } });
    const report = await checkParity(db);
    expect(report.tables.map((table) => [table.table, table.missing])).toEqual([
      ["conversations", 0],
      ["exchanges", 1],
      ["answers", 1],
    ]);
  });

  test("a restarted backfill repairs it, and the gate passes again", async () => {
    await runBackfill(db, { batchSize: 3, log, restart: true });
    expect((await checkParity(db)).ok).toBe(true);
  });

  test("an orphaned copy is counted", async () => {
    for (const statement of UNDO_FINISH_SQL) await db.$executeRawUnsafe(statement);
    await db.$executeRawUnsafe(
      `INSERT INTO "answers" ("id", "exchange_id", "answerer_ref", "answerer_label") VALUES ('orphan', 'no-such-exchange', 'm', 'M')`,
    );
    const report = await checkParity(db);
    expect(report.orphans["answers without their exchange"]).toBe(1);
    expect(report.tables.find((table) => table.table === "answers")?.extra).toBe(1);
    expect(report.ok).toBe(false);
    await db.$executeRawUnsafe(`DELETE FROM "answers" WHERE "id" = 'orphan'`);
  });

  test("the report names tables, rules and counts only", async () => {
    for (const line of reportLines(await checkParity(db))) {
      expect(line).not.toContain("Made-up");
      expect(line).not.toContain("tlenc1.");
      expect(line).toMatch(/^[a-z' ]+: [\d\w ,]+$|^parity (OK|FAIL)$/);
    }
  });
});
