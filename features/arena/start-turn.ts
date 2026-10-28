"use server";

import { trackPromptSent } from "@/infrastructure/analytics-events";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { ensureAppUser } from "@/infrastructure/current-user";
import { database } from "@/infrastructure/database";
import { serverEnv } from "@/infrastructure/env";
import { fetchChatCatalog } from "@/infrastructure/fetch-model-catalog";

import type { AnswerSource } from "./conversation";
import { checkTurnRequest, TURN_COPY, type TurnPlan } from "./turn-rules";

/**
 * Writes a prompt down before any model sees it: the thread when it is new,
 * the turn, and one STREAMING answer row per model, as one nested write.
 * `/api/chat` only answers for a row that already exists and belongs to the
 * caller, so a stream can never write into someone else's thread.
 *
 * Nothing is revalidated here. The screen that called this keeps its streams
 * open in the same tree, and a refresh would tear them down; the sidebar learns
 * about the thread from `thread-history-store` instead.
 */

type ChosenModel = TurnPlan["models"][number];

export type StartTurnInput = Readonly<{
  /** Null starts a new thread. */
  threadId: string | null;
  prompt: string;
  models: readonly ChosenModel[];
  /** The skill the prompt was sent with; only names the thread title. */
  skill?: string | null;
}>;

export type StartedTurn = Readonly<{
  ok: true;
  threadId: string;
  threadTitle: string;
  turnId: string;
  responses: readonly AnswerSource[];
}>;

export type StartTurnResult = StartedTurn | Readonly<{ ok: false; error: string }>;

/** The turn and its empty answer rows, as a nested create. */
const newTurn = (plan: TurnPlan) => ({
  prompt: plan.prompt,
  responses: {
    createMany: {
      data: plan.models.map(({ id, name }, position) => ({
        modelId: id,
        modelName: name,
        position,
      })),
    },
  },
});

/** Read back: the newest turn of the thread and its rows. */
const turnReadBack = {
  id: true,
  title: true,
  turns: {
    orderBy: { createdAt: "desc" },
    take: 1,
    select: {
      id: true,
      responses: { select: { id: true, modelId: true, modelName: true } },
    },
  },
} as const;

const writeTurn = async (
  ownerId: string,
  threadId: string | null,
  plan: TurnPlan,
): Promise<StartTurnResult> =>
  database().$transaction(async (db) => {
    if (threadId !== null) {
      const existing = await db.thread.findUnique({
        where: { id: threadId },
        select: { userId: true },
      });
      if (existing === null) return { ok: false, error: TURN_COPY.threadGone };
      if (existing.userId !== ownerId)
        return { ok: false, error: TURN_COPY.notYourThread };
    }

    const thread =
      threadId === null
        ? await db.thread.create({
            data: {
              userId: ownerId,
              title: plan.title,
              turns: { create: newTurn(plan) },
            },
            select: turnReadBack,
          })
        : await db.thread.update({
            where: { id: threadId },
            data: { updatedAt: new Date(), turns: { create: newTurn(plan) } },
            select: turnReadBack,
          });

    const [turn] = thread.turns;
    if (!turn) throw new Error("the new turn was not read back");
    // Put the rows in the order the models were chosen, which is the order
    // the columns appear in.
    const byModel = new Map(turn.responses.map((row) => [row.modelId, row]));
    return {
      ok: true,
      threadId: thread.id,
      threadTitle: thread.title,
      turnId: turn.id,
      responses: plan.models.flatMap(({ id }) => byModel.get(id) ?? []),
    };
  });

export const startTurn = async (input: StartTurnInput): Promise<StartTurnResult> => {
  const actorId = await resolveActorId();
  if (actorId === null) return { ok: false, error: TURN_COPY.signIn };

  const checked = checkTurnRequest(
    {
      prompt: input.prompt,
      modelIds: input.models.map(({ id }) => id),
      skill: input.skill ?? null,
    },
    await fetchChatCatalog(),
    serverEnv().LLM_PROVIDER,
  );
  if (!checked.ok) return checked;

  const { id: ownerId } = await ensureAppUser(actorId);
  const result = await writeTurn(ownerId, input.threadId, checked.plan);
  if (result.ok) {
    trackPromptSent({
      clerkId: actorId,
      threadId: result.threadId,
      turnId: result.turnId,
      modelIds: result.responses.map(({ modelId }) => modelId),
    });
  }
  return result;
};
