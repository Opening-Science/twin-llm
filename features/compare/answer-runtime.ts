import "server-only";

import { loadGenomeThread } from "@/features/chat/load-genome-thread";
import {
  markModelResponseFailed,
  markModelResponseRefused,
} from "@/features/chat/persist-model-response";
import { streamModelResponse } from "@/features/chat/stream-model-response";
import { loadWearableContext } from "@/features/chat/wearable-context";
import { getLatestGoogleHealthSummary } from "@/features/google-health/connection";
import { notesBeforeThread } from "@/features/memory/note-store";
import { loadDisabledSources } from "@/features/onboarding/onboarding-store";
import { getLatestOuraSummary } from "@/features/oura/connection";
import { findSkillFor } from "@/features/skills/user-skill-store";
import { getLatestVitronicSummary } from "@/features/vitronic/connection";
import { getLatestWhoopSummary } from "@/features/whoop/connection";
import { database } from "@/infrastructure/database";
import { exoscalePersonalData, serverEnv } from "@/infrastructure/env";
import { chatModelIsLocal } from "@/infrastructure/genome-gate";
import { loadLiveSources } from "@/infrastructure/live-source-store";
import { append } from "@/packages/audit/append";

import { createAnswerStart } from "./answer-start";

/**
 * The real reads behind one answer's start (`answer-start.ts`), for
 * `POST /api/chat` and the scheduled run. Live public lookups are never
 * offered in local-only mode; twin notes come only from before the thread
 * began, and none when the person turned loading them off.
 */
export const startAnswer = createAnswerStart({
  settings: () => {
    const env = serverEnv();
    return {
      dataMode: env.DATA_MODE,
      provider: env.LLM_PROVIDER,
      exoscalePersonalData: exoscalePersonalData(env),
    };
  },
  chatIsLocal: chatModelIsLocal,
  loadGenomeThread,
  loadWearables: (mode, appUserId) =>
    loadWearableContext(mode, appUserId, {
      oura: getLatestOuraSummary,
      whoop: getLatestWhoopSummary,
      googleHealth: getLatestGoogleHealthSummary,
      vitronic: getLatestVitronicSummary,
    }),
  loadDisabledSources,
  loadLiveSources: async (appUserId) =>
    serverEnv().LOCAL_ONLY ? [] : loadLiveSources(appUserId),
  appendAudit: (input) => append(database(), input),
  findSkill: findSkillFor,
  loadTwinNotes: notesBeforeThread,
  stream: streamModelResponse,
  markRefused: markModelResponseRefused,
  markFailed: markModelResponseFailed,
  logError: (message, name) => {
    console.error(`[chat] ${message}`, name);
  },
});
