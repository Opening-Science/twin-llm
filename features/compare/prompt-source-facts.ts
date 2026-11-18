import "server-only";

import { serverEnv } from "@/infrastructure/env";
import { genomeChatPermit, vcfVariantsChatPermit } from "@/infrastructure/genome-gate";
import { importedDataChatPermit } from "@/infrastructure/imported-data-gate";
import { loadLiveSources } from "@/infrastructure/live-source-store";

import type { PromptSourceFacts } from "./conversation";

/**
 * What the `@` sources list may offer (SERVER-SPEC 3.10): plain booleans and
 * ids only. Live lookups are none when incognito, without an app user, or in
 * local-only mode, as the chat route sends none there either.
 */
export const loadPromptSourceFacts = async (
  appUserId: string | null,
  incognito: boolean,
): Promise<PromptSourceFacts> => ({
  imported: importedDataChatPermit().ok,
  genome: genomeChatPermit().ok || vcfVariantsChatPermit().ok,
  live:
    incognito || appUserId === null || serverEnv().LOCAL_ONLY
      ? []
      : await loadLiveSources(appUserId),
});
