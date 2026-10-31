import { generateText } from "ai";

import { guardChatRequest } from "@/features/chat/chat-protection";
import { resolveLanguageModel } from "@/features/chat/resolve-language-model";
import { connectGroups, linkedNames } from "@/features/onboarding/connect-rows";
import { createStarterGenerate } from "@/features/onboarding/starter-generate";
import { createStarterQuestionsHandler } from "@/features/onboarding/starter-handler";
import { STARTER_TIMEOUT_MS } from "@/features/onboarding/starter-questions";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { findAppUserId } from "@/infrastructure/current-user";
import { database } from "@/infrastructure/database";
import { exoscalePersonalData, isAuthDisabled, serverEnv } from "@/infrastructure/env";
import { fetchActiveModelCatalog } from "@/infrastructure/fetch-model-catalog";
import { defaultModelSelection } from "@/infrastructure/model-catalog";
import { personalDataSentEvent } from "@/infrastructure/personal-data-audit";
import { append } from "@/packages/audit/append";

import { loadConnectFacts } from "../connect-facts";
import { withUnlocked } from "@/infrastructure/vault-runtime";

/**
 * Three starter questions for the last /start step, from the first model of
 * the default selection on the configured provider. The provider policy runs
 * as for chat: with a linked source or personal data, a provider that may not
 * receive it refuses, and the handler falls back to fixed starters. A personal
 * request to Exoscale under the consented pilot is audited first, as in chat.
 * The chat rate limit applies when sign-in is on, since each call runs the
 * model.
 */
export const POST = withUnlocked(
  createStarterQuestionsHandler({
    resolveActorId,
    findAppUserId,
    loadLinkedNames: async (appUserId) =>
      linkedNames(connectGroups(await loadConnectFacts(appUserId))),
    generate: createStarterGenerate({
      loadModelIds: async () => {
        const catalog = await fetchActiveModelCatalog();
        return catalog ? defaultModelSelection(catalog) : null;
      },
      resolveModel: resolveLanguageModel,
      recordSend: async ({ actor, modelId, hasWearableNarrative }) => {
        const env = serverEnv();
        const event = personalDataSentEvent(
          {
            mode: env.DATA_MODE,
            provider: env.LLM_PROVIDER,
            hasWearableNarrative,
            exoscalePersonalData: exoscalePersonalData(env),
          },
          { actor, sessionId: actor, modelId },
        );
        if (event !== null) await append(database(), event);
      },
      generateText,
    }),
    timeoutMs: STARTER_TIMEOUT_MS,
    logError: console.error,
    guard: (request, clerkId) =>
      isAuthDisabled() ? Promise.resolve(null) : guardChatRequest(request, clerkId),
  }),
);
