"use server";

import { startTurn } from "@/features/arena/start-turn";
import type { StartThreadResult } from "@/features/onboarding/onboarding-flow";
import { completeOnboarding } from "@/features/onboarding/onboarding-store";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { ensureAppUser } from "@/infrastructure/current-user";
import { runnableSkills } from "@/features/skills/load-skills";
import { fetchChatCatalog } from "@/infrastructure/fetch-model-catalog";
import { defaultModelSelection } from "@/infrastructure/model-catalog";

const MAX_STARTER_PROMPT = 2000;

/**
 * Opens a new thread with the starter question the person picked, on the
 * default models, through the arena's own `startTurn`. The thread page then
 * streams the answers as for any new turn. Onboarding counts as done once the
 * thread exists.
 */
export const startStarterThread = async (
  question: string,
): Promise<StartThreadResult> => {
  const prompt = question.trim().slice(0, MAX_STARTER_PROMPT);
  if (!prompt) return { ok: false, error: "Write a question first." };

  const catalog = await fetchChatCatalog(runnableSkills());
  if (!catalog || catalog.length === 0) {
    return {
      ok: false,
      error: "We can't reach the model list right now. Try again in a moment.",
    };
  }

  const models = defaultModelSelection(catalog).flatMap((id) => {
    const model = catalog.find((candidate) => candidate.id === id);
    return model ? [{ id: model.id, name: model.name }] : [];
  });

  const result = await startTurn({ threadId: null, prompt, models });
  if (!result.ok) return { ok: false, error: result.error };

  try {
    const clerkId = await resolveActorId();
    if (clerkId) await completeOnboarding((await ensureAppUser(clerkId)).id);
  } catch (error) {
    // The thread exists; a missed completion only means /start shows again.
    console.error(
      "[onboarding] could not mark complete",
      error instanceof Error ? error.name : "unknown",
    );
  }

  return { ok: true, threadId: result.threadId };
};
