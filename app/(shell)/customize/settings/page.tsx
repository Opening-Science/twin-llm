import { saveLiveSourceChoice } from "@/features/connectors/live-source-actions";
import { saveNotesLoading } from "@/features/memory/note-actions";
import { notesOff } from "@/features/memory/note-store";
import { sourceAvailability } from "@/features/onboarding/connect-rows";
import { dataModeSentence, HOW_TO_SWITCH } from "@/features/onboarding/data-residency";
import {
  countIndexedDocuments,
  loadDisabledSources,
} from "@/features/onboarding/onboarding-store";
import { saveKnowledgeSourceChoice } from "@/features/onboarding/source-actions";
import { SettingsScreen } from "@/features/settings/settings-screen";
import { SETTING_DEFAULTS } from "@/features/settings/settings-view";
import { lockedScreen } from "@/features/vault/page-gate";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { findAppUserId } from "@/infrastructure/current-user";
import { gbdEnv, serverEnv } from "@/infrastructure/env";
import { genomeChatPermit, vcfVariantsChatPermit } from "@/infrastructure/genome-gate";
import { importedDataChatPermit } from "@/infrastructure/imported-data-gate";
import { isActiveAt } from "@/infrastructure/learning-consent";
import { listLearningConsentEntries } from "@/infrastructure/learning-consent-store";
import { loadLiveSources } from "@/infrastructure/live-source-store";

/**
 * Customize · Settings (#507): every keep and withhold choice on one page,
 * read from the stores each choice already had and saved through their own
 * audited actions. Someone without a saved choice sees the safe defaults.
 */
export default async function CustomizeSettingsPage() {
  const locked = await lockedScreen();
  if (locked) return locked;
  const env = serverEnv();
  const mode = env.DATA_MODE;
  const actor = await resolveActorId();
  const userId = actor === null ? null : await findAppUserId(actor);
  const safe = SETTING_DEFAULTS[mode];
  const [off, disabledSources, liveSources, consents, documents] = await Promise.all([
    userId === null ? !safe.notesOn : notesOff(userId),
    userId === null ? safe.disabledSources : loadDisabledSources(userId),
    userId === null ? safe.liveSources : loadLiveSources(userId),
    userId === null || mode !== "personal" ? [] : listLearningConsentEntries(userId),
    countIndexedDocuments(),
  ]);
  const now = new Date();
  return (
    <SettingsScreen
      facts={{
        mode,
        localOnly: env.LOCAL_ONLY,
        signedIn: actor !== null,
        availability: sourceAvailability({
          dataMode: mode,
          guidelineDocuments: documents.guidelines,
          knowledgeDocuments: documents.knowledge,
          gbdConfigured: gbdEnv() !== null,
          genomeChat: genomeChatPermit().ok,
          vcfChat: vcfVariantsChatPermit().ok,
          importedChat: importedDataChatPermit().ok,
        }),
        activeConsents: consents.filter((consent) => isActiveAt(consent, now)).length,
        dataModeSentence: dataModeSentence(mode),
        howToSwitch: HOW_TO_SWITCH,
      }}
      initialState={{ notesOn: !off, disabledSources, liveSources }}
      actions={{
        saveNotes: saveNotesLoading,
        saveSources: saveKnowledgeSourceChoice,
        saveLive: saveLiveSourceChoice,
      }}
    />
  );
}
