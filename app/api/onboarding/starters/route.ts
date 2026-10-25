import { generateText } from "ai";

import { guardChatRequest } from "@/features/chat/chat-protection";
import { resolveLanguageModel } from "@/features/chat/resolve-language-model";
import { connectGroups, linkedNames } from "@/features/onboarding/connect-rows";
import { createStarterGenerate } from "@/features/onboarding/starter-generate";
import { createStarterQuestionsHandler } from "@/features/onboarding/starter-handler";
import { STARTER_TIMEOUT_MS } from "@/features/onboarding/starter-questions";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { findAppUserId } from "@/infrastructure/current-user";
import { isAuthDisabled } from "@/infrastructure/env";
import { fetchActiveModelCatalog } from "@/infrastructure/fetch-model-catalog";
import { defaultModelSelection } from "@/infrastructure/model-catalog";

import { loadConnectFacts } from "../connect-facts";

/**
 * Three starter questions for the last /start step, from the first model of
 * the default selection on the configured provider. The provider policy runs
 * as for chat: with a linked source, OpenRouter and the remote GPU refuse,
 * and the handler falls back to fixed starters. The chat rate limit applies
 * when sign-in is on, since each call runs the model.
 */
export const POST = createStarterQuestionsHandler({
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
    generateText,
  }),
  timeoutMs: STARTER_TIMEOUT_MS,
  logError: console.error,
  guard: (request, clerkId) =>
    isAuthDisabled() ? Promise.resolve(null) : guardChatRequest(request, clerkId),
});
