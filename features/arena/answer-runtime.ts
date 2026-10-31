import "server-only";

import { loadGenomeThread } from "@/features/chat/load-genome-thread";
import { markModelResponseRefused } from "@/features/chat/persist-model-response";
import { createStartAnswer } from "@/features/chat/start-answer";
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
import { exoscalePersonalData, isLocalOnly, serverEnv } from "@/infrastructure/env";
import { chatModelIsLocal } from "@/infrastructure/genome-gate";
import { loadLiveSources } from "@/infrastructure/live-source-store";
import { append } from "@/packages/audit/append";

/**
 * The one `startAnswer` of this server: the provider, skill, genome and
 * data-mode checks with the real reads, then the stream. `POST /api/chat`
 * calls it for a typed turn and the task scheduler (#54) for a scheduled
 * one, so the two go through the same permits, audit rows and ledger.
 */
export const startAnswer = createStartAnswer({
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
  // Local-only mode offers no live lookup; each call would be refused anyway.
  loadLiveSources: async (appUserId) => (isLocalOnly() ? [] : loadLiveSources(appUserId)),
  appendAudit: (input) => append(database(), input),
  findSkill: findSkillFor,
  loadTwinNotes: notesBeforeThread,
  stream: streamModelResponse,
  // The person still gets the refusal when the row cannot be written; a
  // reload then asks again, which is how a refused turn behaved before.
  markRefused: (target) =>
    markModelResponseRefused(target).catch((error: unknown) => {
      console.error(
        "[chat] could not store the refusal",
        error instanceof Error ? error.name : "unknown",
      );
    }),
});
