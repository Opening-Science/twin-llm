import "server-only";

import { openChatText, sealChatText } from "@/infrastructure/chat-seal-contexts";
import { database } from "@/infrastructure/database";
import { type FieldCipher, newRowId } from "@/infrastructure/field-cipher";
import { cipherForUser } from "@/infrastructure/field-cipher-runtime";

import type { StartTurnResult } from "./start-turn-result";
import type { TurnPlan } from "./turn-plan";

/**
 * The one write behind every turn, typed or scheduled (SERVER-SPEC 3.2), so
 * rows never differ in shape or sealing. Ids are made here before anything
 * is sealed, because each id is part of its value's sealing context. One
 * transaction: the conversation (new, or the owner's existing one), the
 * exchange, and one empty streaming answer row per picked model, in pick
 * order. Values are sealed under the frozen context names of
 * `chat-seal-contexts.ts`. Database and cipher errors are not caught: the
 * caller decides what the person reads.
 */

export const THREAD_GONE_SENTENCE = "That thread doesn't exist any more.";
export const NOT_YOUR_THREAD_SENTENCE = "That thread isn't yours to add to.";

export type TurnWrite = Readonly<{
  ownerId: string;
  threadId: string | null;
  plan: TurnPlan;
  /** The scheduled task that asks it, or null when a person does. */
  scheduleId: string | null;
}>;

const answerRows = (cipher: FieldCipher, plan: TurnPlan) =>
  plan.models.map((model, columnIndex) => {
    const id = newRowId();
    return {
      id,
      answererRef: model.id,
      answererLabel: model.name,
      columnIndex,
      bodySealed: sealChatText(cipher, "answers", "body_sealed", id, ""),
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
  const exchange = {
    id: turnId,
    questionSealed: sealChatText(
      cipher,
      "exchanges",
      "question_sealed",
      turnId,
      input.plan.prompt,
    ),
    origin: input.scheduleId === null ? ("person" as const) : ("schedule" as const),
    scheduleId: input.scheduleId,
    skillName: input.plan.skill,
    bubbleTextSealed:
      input.plan.label === null
        ? null
        : sealChatText(
            cipher,
            "exchanges",
            "bubble_text_sealed",
            turnId,
            input.plan.label,
          ),
    answers: { create: rows },
  };
  try {
    const written = await database().$transaction(async (tx) => {
      if (input.threadId === null) {
        const threadId = newRowId();
        await tx.conversation.create({
          data: {
            id: threadId,
            ownerId: input.ownerId,
            titleSealed: sealChatText(
              cipher,
              "conversations",
              "title_sealed",
              threadId,
              input.plan.title,
            ),
            exchanges: { create: [exchange] },
          },
        });
        return { threadId, threadTitle: input.plan.title };
      }
      const conversation = await tx.conversation.findUnique({
        where: { id: input.threadId },
        select: { ownerId: true, titleSealed: true },
      });
      if (conversation === null) throw new Refused(THREAD_GONE_SENTENCE);
      if (conversation.ownerId !== input.ownerId) {
        throw new Refused(NOT_YOUR_THREAD_SENTENCE);
      }
      await tx.conversation.update({
        where: { id: input.threadId },
        data: { lastActivityAt: new Date(), exchanges: { create: [exchange] } },
      });
      return {
        threadId: input.threadId,
        threadTitle: openChatText(
          cipher,
          "conversations",
          "title_sealed",
          input.threadId,
          conversation.titleSealed,
        ),
      };
    });
    return {
      ok: true,
      ...written,
      turnId,
      responses: rows.map(({ id, answererRef, answererLabel }) => ({
        id,
        modelId: answererRef,
        modelName: answererLabel,
      })),
    };
  } catch (error) {
    if (error instanceof Refused) return { ok: false, error: error.sentence };
    throw error;
  }
};
