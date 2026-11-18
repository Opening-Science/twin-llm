import "server-only";

import { markModelResponseFailed } from "@/features/chat/persist-model-response";
import { publicProviderFailure } from "@/features/chat/public-provider-failure";
import { runnableSkills } from "@/features/skills/load-skills";
import { database } from "@/infrastructure/database";
import { serverEnv } from "@/infrastructure/env";
import { fetchChatCatalog } from "@/infrastructure/fetch-model-catalog";

import { startAnswer } from "./answer-runtime";
import { createScheduledTurn } from "./scheduled-turn";
import { writeTurn } from "./turn-writer";

/**
 * The scheduled turn bound to the real catalog, database and answer start;
 * `instrumentation.ts` hands it to the task scheduler. It cannot be stopped,
 * and it passes no thinking capability.
 */
export const runScheduledTurn = createScheduledTurn({
  catalog: () => fetchChatCatalog(runnableSkills()),
  provider: () => serverEnv().LLM_PROVIDER,
  writeTurn,
  startAnswer: (actorId, appUserId, call, agent) =>
    startAnswer(actorId, appUserId, call, agent),
  markFailed: markModelResponseFailed,
  storedStatus: async (target) =>
    (
      await database().modelResponse.findUnique({
        where: { turnId_modelId: target },
        select: { status: true },
      })
    )?.status ?? null,
  logError: (message, detail) => {
    console.error(`[tasks] ${message}`, publicProviderFailure(detail));
  },
});
