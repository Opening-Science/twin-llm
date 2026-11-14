import "server-only";

import { database } from "@/infrastructure/database";
import { type FieldCipher, newRowId, sealNullable } from "@/infrastructure/field-cipher";
import { cipherForUser } from "@/infrastructure/field-cipher-runtime";
import {
  RESPONSES,
  THREADS,
  TURNS,
  openThreadTitle,
} from "@/infrastructure/thread-fields";

import type { StartTurnResult } from "./start-turn-result";
import type { TurnPlan } from "./turn-plan";

/**
 * The one write behind every turn, typed or scheduled (SERVER-SPEC 3.2), so
 * rows never differ in shape or sealing. Ids are made here before anything
 * is sealed, because each id is part of its value's sealing context. One
 * transaction: the thread (new, or the owner's existing one), the turn, and
 * one empty STREAMING answer row per picked model, in pick order. Database
 * and cipher errors are not caught: the caller decides what the person reads.
 */

export const THREAD_GONE_SENTENCE = "That thread doesn't exist any more.";
export const NOT_YOUR_THREAD_SENTENCE = "That thread isn't yours to add to.";

export type TurnWrite = Readonly<{
  ownerId: string;
  threadId: string | null;
  plan: TurnPlan;
  scheduled: boolean;
}>;

const answerRows = (cipher: FieldCipher, plan: TurnPlan) =>
  plan.models.map((model, position) => {
    const id = newRowId();
    return {
      id,
      modelId: model.id,
      modelName: model.name,
      position,
      text: cipher.sealText(RESPONSES, "text", id, ""),
    };
  });

class Refused extends Error {
  readonly sentence: string;
  constructor(sentence: string) {
    super(sentence);
    this.name = "TurnRefused";
    this.sentence = sentence;
  }
}

export const writeTurn = async (input: TurnWrite): Promise<StartTurnResult> => {
  const cipher = await cipherForUser(input.ownerId);
  const turnId = newRowId();
  const rows = answerRows(cipher, input.plan);
  const turn = {
    id: turnId,
    prompt: cipher.sealText(TURNS, "prompt", turnId, input.plan.prompt),
    scheduled: input.scheduled,
    skill: input.plan.skill,
    label: sealNullable(cipher, TURNS, "label", turnId, input.plan.label),
    responses: { create: rows },
  };
  try {
    const written = await database().$transaction(async (tx) => {
      if (input.threadId === null) {
        const threadId = newRowId();
        await tx.thread.create({
          data: {
            id: threadId,
            userId: input.ownerId,
            title: cipher.sealText(THREADS, "title", threadId, input.plan.title),
            turns: { create: [turn] },
          },
        });
        return { threadId, threadTitle: input.plan.title };
      }
      const thread = await tx.thread.findUnique({
        where: { id: input.threadId },
        select: { userId: true, title: true },
      });
      if (thread === null) throw new Refused(THREAD_GONE_SENTENCE);
      if (thread.userId !== input.ownerId) throw new Refused(NOT_YOUR_THREAD_SENTENCE);
      await tx.thread.update({
        where: { id: input.threadId },
        data: { updatedAt: new Date(), turns: { create: [turn] } },
      });
      return {
        threadId: input.threadId,
        threadTitle: openThreadTitle(cipher, input.threadId, thread.title),
      };
    });
    return {
      ok: true,
      ...written,
      turnId,
      responses: rows.map(({ id, modelId, modelName }) => ({ id, modelId, modelName })),
    };
  } catch (error) {
    if (error instanceof Refused) return { ok: false, error: error.sentence };
    throw error;
  }
};
