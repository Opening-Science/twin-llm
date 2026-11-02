import { generateText } from "ai";

import { guardChatRequest } from "@/features/chat/chat-protection";
import { resolveLanguageModel } from "@/features/chat/resolve-language-model";
import { createCompactHandler } from "@/features/memory/compact-handler";
import { runnableSkills } from "@/features/skills/load-skills";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { database } from "@/infrastructure/database";
import { exoscalePersonalData, isAuthDisabled, serverEnv } from "@/infrastructure/env";
import { fetchChatCatalog } from "@/infrastructure/fetch-model-catalog";
import { chatModelIsLocal } from "@/infrastructure/genome-gate";
import { findCatalogRow, turnAgentOf } from "@/infrastructure/model-catalog";
import { personalDataSentEvent } from "@/infrastructure/personal-data-audit";
import { append } from "@/packages/audit/append";

import { ownedThreadForNote, threadIsLocal } from "../thread-facts";
import { withUnlocked } from "@/infrastructure/vault-runtime";

/** A draft that takes longer than this falls back to the person's own questions. */
const DRAFT_TIMEOUT_MS = 90_000;

const settings = () => {
  const env = serverEnv();
  return {
    mode: env.DATA_MODE,
    provider: env.LLM_PROVIDER,
    exoscalePersonalData: exoscalePersonalData(env),
  };
};

const draft = createCompactHandler({
  resolveActorId,
  loadOwnedThread: ownedThreadForNote,
  threadIsLocal,
  turn: () => ({ ...settings(), chatIsLocal: chatModelIsLocal() }),
  draftModel: async (source, disclosure, typed) => {
    const catalog = await fetchChatCatalog(runnableSkills());
    if (catalog === null || findCatalogRow(source.modelId, catalog) === null) return null;
    const agent = turnAgentOf(source.modelId, catalog, source.prompt, source.modelName);
    const modelId = agent?.baseModelId ?? source.modelId;
    const model = resolveLanguageModel(modelId, {
      hasWearableNarrative: false,
      disclosure,
      typed,
    });
    return {
      modelId,
      generate: async ({ system, prompt }) =>
        (
          await generateText({
            model,
            system,
            prompt,
            maxRetries: 0,
            abortSignal: AbortSignal.timeout(DRAFT_TIMEOUT_MS),
          })
        ).text,
    };
  },
  providerEvent: (actor, sessionId, modelId) => {
    const current = settings();
    return personalDataSentEvent(
      {
        mode: current.mode,
        provider: current.provider,
        hasWearableNarrative: false,
        exoscalePersonalData: current.exoscalePersonalData,
      },
      { actor, sessionId, modelId },
    );
  },
  appendAudit: (input) => append(database(), input),
  logError: (message, name) => console.error(message, name),
});

/**
 * `/compact` (#43): a draft twin note of the person's own thread. The chat
 * rate limit applies when sign-in is on, since it runs a model.
 */
export const POST = withUnlocked(async (request: Request): Promise<Response> => {
  const actor = await resolveActorId();
  if (actor !== null && !isAuthDisabled()) {
    const throttled = await guardChatRequest(request, actor);
    if (throttled !== null) return throttled;
  }
  return draft(request);
});
