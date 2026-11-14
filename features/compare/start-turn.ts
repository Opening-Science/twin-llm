"use server";

import { runnableSkills } from "@/features/skills/load-skills";
import { trackPromptSent } from "@/infrastructure/analytics-events";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { ensureAppUser } from "@/infrastructure/current-user";
import { serverEnv } from "@/infrastructure/env";
import { fetchChatCatalog } from "@/infrastructure/fetch-model-catalog";
import { vaultRefusalForAction } from "@/infrastructure/vault-runtime";

import type { PickedModel } from "./conversation";
import type { StartTurnResult } from "./start-turn-result";
import { planTurn, SIGN_IN_SENTENCE } from "./turn-plan";
import { writeTurn } from "./turn-writer";

/**
 * Writes a prompt down before any model sees it (SERVER-SPEC 3.3): the
 * screen calls it on send, the onboarding starter on its first question.
 * Display names the browser sends are ignored; the catalog names the rows.
 * Nothing is revalidated: the calling screen keeps its streams open, and the
 * sidebar learns of a new thread from the client store.
 */
export const startTurn = async (
  input: Readonly<{
    threadId: string | null;
    prompt: string;
    models: readonly PickedModel[];
    skill?: string | null;
    label?: string | null;
  }>,
): Promise<StartTurnResult> => {
  const actorId = await resolveActorId();
  if (actorId === null) return { ok: false, error: SIGN_IN_SENTENCE };
  const locked = await vaultRefusalForAction();
  if (locked !== null) return { ok: false, error: locked };

  const planned = planTurn(
    {
      prompt: input.prompt,
      modelIds: input.models.map((model) => model.id),
      skill: input.skill ?? null,
      label: input.label ?? null,
    },
    await fetchChatCatalog(runnableSkills()),
    serverEnv().LLM_PROVIDER,
  );
  if (!planned.ok) return planned;

  const owner = await ensureAppUser(actorId);
  const result = await writeTurn({
    ownerId: owner.id,
    threadId: input.threadId,
    plan: planned.plan,
    scheduled: false,
  });
  if (result.ok) {
    trackPromptSent({
      clerkId: actorId,
      threadId: result.threadId,
      turnId: result.turnId,
      modelIds: planned.plan.models.map((model) => model.id),
    });
  }
  return result;
};
