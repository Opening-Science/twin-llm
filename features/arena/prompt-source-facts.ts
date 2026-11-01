import "server-only";

import { isLocalOnly } from "@/infrastructure/env";
import { genomeChatPermit, vcfVariantsChatPermit } from "@/infrastructure/genome-gate";
import { importedDataChatPermit } from "@/infrastructure/imported-data-gate";
import { loadLiveSources } from "@/infrastructure/live-source-store";

import type { PromptSourceFacts } from "./prompt-sources";

/**
 * What the prompt bar's `@` menu may offer this person here (#366): the same
 * permits the chat tools ask before every read, and the live lookups they
 * switched on. An incognito chat and local-only mode offer no live lookup, as
 * the chat route sends none there.
 */
export const loadPromptSourceFacts = async (
  appUserId: string | null,
  incognito: boolean,
): Promise<PromptSourceFacts> => ({
  imported: importedDataChatPermit().ok,
  genome: genomeChatPermit().ok || vcfVariantsChatPermit().ok,
  live:
    incognito || appUserId === null || isLocalOnly()
      ? []
      : await loadLiveSources(appUserId),
});
