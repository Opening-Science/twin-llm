"use server";

import { runnableSkills } from "@/features/skills/load-skills";
import { trackPromptSent } from "@/infrastructure/analytics-events";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { vaultRefusalForAction } from "@/infrastructure/vault-runtime";
import { ensureAppUser } from "@/infrastructure/current-user";
import { serverEnv } from "@/infrastructure/env";
import { fetchChatCatalog } from "@/infrastructure/fetch-model-catalog";

import { checkTurnRequest, TURN_COPY, type TurnPlan } from "./turn-rules";
import { type StartTurnResult, writeTurn } from "./write-turn";

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

export type { StartedTurn, StartTurnResult } from "./write-turn";

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
