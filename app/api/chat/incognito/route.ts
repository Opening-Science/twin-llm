import { guardChatRequest } from "@/features/chat/chat-protection";
import { genomeToolDepsFor } from "@/features/chat/genome-tool-deps";
import { createIncognitoChatHandler } from "@/features/chat/incognito-chat";
import { resolveLanguageModel } from "@/features/chat/resolve-language-model";
import { loadSessionAudit } from "@/features/chat/response/load-session-audit";
import { loadWearableContext } from "@/features/chat/wearable-context";
import { getLatestGoogleHealthSummary } from "@/features/google-health/connection";
import { loadDisabledSources } from "@/features/onboarding/onboarding-store";
import { getLatestOuraSummary } from "@/features/oura/connection";
import { findRunnableSkill } from "@/features/skills/load-skills";
import { getLatestVitronicSummary } from "@/features/vitronic/connection";
import { getLatestWhoopSummary } from "@/features/whoop/connection";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { findAppUserId } from "@/infrastructure/current-user";
import { database } from "@/infrastructure/database";
import { exoscalePersonalData, isAuthDisabled, serverEnv } from "@/infrastructure/env";
import { fetchActiveModelCatalog } from "@/infrastructure/fetch-model-catalog";
import { chatModelIsLocal } from "@/infrastructure/genome-gate";
import { append } from "@/packages/audit/append";

/**
 * One model's answer for an incognito chat: never saved, local models only.
 * The rules are in `features/chat/incognito-chat.ts`; this file only wires the
 * real reads. Nothing here writes a thread, turn or answer row.
 */
export const POST = createIncognitoChatHandler({
  resolveActorId,
  guard: (request, actorId) =>
    isAuthDisabled() ? Promise.resolve(null) : guardChatRequest(request, actorId),
  catalog: fetchActiveModelCatalog,
  chatIsLocal: chatModelIsLocal,
  findAppUserId,
  settings: () => {
    const env = serverEnv();
    return {
      dataMode: env.DATA_MODE,
      provider: env.LLM_PROVIDER,
      exoscalePersonalData: exoscalePersonalData(env),
    };
  },
  loadWearables: (mode, appUserId) =>
    loadWearableContext(mode, appUserId, {
      oura: getLatestOuraSummary,
      whoop: getLatestWhoopSummary,
      googleHealth: getLatestGoogleHealthSummary,
      vitronic: getLatestVitronicSummary,
    }),
  loadDisabledSources,
  appendAudit: (input) => append(database(), input),
  findSkill: findRunnableSkill,
  randomId: () => crypto.randomUUID(),
  pipeline: {
    resolveModel: resolveLanguageModel,
    genomeTools: genomeToolDepsFor,
    loadAudit: loadSessionAudit,
  },
});
