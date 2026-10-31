import "server-only";

import { markModelResponseFailed } from "@/features/chat/persist-model-response";
import { publicProviderFailure } from "@/features/chat/public-provider-failure";
import { runnableSkills } from "@/features/skills/load-skills";
import { database } from "@/infrastructure/database";
import { serverEnv } from "@/infrastructure/env";
import { fetchChatCatalog } from "@/infrastructure/fetch-model-catalog";

import { startAnswer } from "./answer-runtime";
import { createScheduledTurn } from "./scheduled-turn";
import { writeTurn } from "./write-turn";

/** `createScheduledTurn` with this server's catalog, rows and `startAnswer`. */
export const runScheduledTurn = createScheduledTurn({
  provider: () => serverEnv().LLM_PROVIDER,
  catalog: () => fetchChatCatalog(runnableSkills()),
  writeTurn,
  startAnswer,
  markFailed: markModelResponseFailed,
  answerStatus: async (turnId, modelId) =>
    (
      await database().modelResponse.findUnique({
        where: { turnId_modelId: { turnId, modelId } },
        select: { status: true },
      })
    )?.status ?? null,
  logError: (message, error) =>
    console.error(`[tasks] ${message}`, publicProviderFailure(error)),
});
