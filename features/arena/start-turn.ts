"use server";

import { runnableSkills } from "@/features/skills/load-skills";
import { trackPromptSent } from "@/infrastructure/analytics-events";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { vaultRefusalForAction } from "@/infrastructure/vault-runtime";
import { ensureAppUser } from "@/infrastructure/current-user";
import { database } from "@/infrastructure/database";
import { type FieldCipher, newRowId } from "@/infrastructure/field-cipher";
import { cipherForUser } from "@/infrastructure/field-cipher-runtime";
import {
  openThreadTitle,
  RESPONSES,
  THREADS,
  TURNS,
} from "@/infrastructure/thread-fields";
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

/**
 * The turn and its empty answer rows, as a nested create. Ids are set here
 * because each is part of its sealed values' context (#141); the empty
 * answer text is sealed too, so no personal row holds a plain value.
 */
const newTurn = (cipher: FieldCipher, plan: TurnPlan) => {
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
      responses: { createMany: { data: responses } },
    },
  };
};

const writeTurn = async (
  ownerId: string,
  threadId: string | null,
  plan: TurnPlan,
): Promise<StartTurnResult> => {
  const cipher = await cipherForUser(ownerId);
  const turn = newTurn(cipher, plan);
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

export const startTurn = async (input: StartTurnInput): Promise<StartTurnResult> => {
  const actorId = await resolveActorId();
  if (actorId === null) return { ok: false, error: TURN_COPY.signIn };
  // A turn stores the prompt in the person's thread: not while locked (#142).
  const locked = await vaultRefusalForAction();
  if (locked !== null) return { ok: false, error: locked };

  const checked = checkTurnRequest(
    {
      prompt: input.prompt,
      modelIds: input.models.map(({ id }) => id),
      skill: input.skill ?? null,
    },
    await fetchChatCatalog(runnableSkills()),
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
