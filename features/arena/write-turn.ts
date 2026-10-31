import "server-only";

import { database } from "@/infrastructure/database";
import { type FieldCipher, newRowId } from "@/infrastructure/field-cipher";
import { cipherForUser } from "@/infrastructure/field-cipher-runtime";
import {
  openThreadTitle,
  RESPONSES,
  THREADS,
  TURNS,
} from "@/infrastructure/thread-fields";

import type { AnswerSource } from "./conversation";
import { TURN_COPY, type TurnPlan } from "./turn-rules";

/**
 * The write behind every turn: the thread when it is new, the turn, and one
 * STREAMING answer row per model, as one nested write. A typed prompt
 * (`startTurn`) and a scheduled task's run (#54, marked `scheduled`) both
 * go through it, so their rows cannot differ in shape or sealing.
 */

export type StartedTurn = Readonly<{
  ok: true;
  threadId: string;
  threadTitle: string;
  turnId: string;
  responses: readonly AnswerSource[];
}>;

export type StartTurnResult = StartedTurn | Readonly<{ ok: false; error: string }>;

/**
 * The turn and its empty answer rows, as a nested create. Ids are set here
 * because each is part of its sealed values' context (#141); the empty
 * answer text is sealed too, so no personal row holds a plain value.
 */
const newTurn = (cipher: FieldCipher, plan: TurnPlan, scheduled: boolean) => {
  const turnId = newRowId();
  const responses = plan.models.map(({ id, name }, position) => {
    const rowId = newRowId();
    return {
      id: rowId,
      modelId: id,
      modelName: name,
      position,
      text: cipher.sealText(RESPONSES, "text", rowId, ""),
    };
  });
  return {
    turnId,
    responses: responses.map(({ id, modelId, modelName }) => ({
      id,
      modelId,
      modelName,
    })),
    create: {
      id: turnId,
      prompt: cipher.sealText(TURNS, "prompt", turnId, plan.prompt),
      scheduled,
      responses: { createMany: { data: responses } },
    },
  };
};

export const writeTurn = async (
  ownerId: string,
  threadId: string | null,
  plan: TurnPlan,
  options: Readonly<{ scheduled?: boolean }> = {},
): Promise<StartTurnResult> => {
  const cipher = await cipherForUser(ownerId);
  const turn = newTurn(cipher, plan, options.scheduled ?? false);
  return database().$transaction(async (db) => {
    let thread: Readonly<{ id: string; title: string }>;
    if (threadId !== null) {
      const existing = await db.thread.findUnique({
        where: { id: threadId },
        select: { userId: true, title: true },
      });
      if (existing === null) return { ok: false, error: TURN_COPY.threadGone };
      if (existing.userId !== ownerId)
        return { ok: false, error: TURN_COPY.notYourThread };
      await db.thread.update({
        where: { id: threadId },
        data: { updatedAt: new Date(), turns: { create: turn.create } },
        select: { id: true },
      });
      thread = { id: threadId, title: openThreadTitle(cipher, threadId, existing.title) };
    } else {
      const id = newRowId();
      await db.thread.create({
        data: {
          id,
          userId: ownerId,
          title: cipher.sealText(THREADS, "title", id, plan.title),
          turns: { create: turn.create },
        },
        select: { id: true },
      });
      thread = { id, title: plan.title };
    }
    // The rows are in the order the models were chosen, which is the order
    // the columns appear in.
    return {
      ok: true,
      threadId: thread.id,
      threadTitle: thread.title,
      turnId: turn.turnId,
      responses: turn.responses,
    };
  });
};
