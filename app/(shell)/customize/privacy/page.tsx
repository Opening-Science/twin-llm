import { DisclosureSection } from "@/features/privacy/disclosure-section";
import { ledgerView } from "@/features/privacy/disclosure-view";
import { PrivacyScreen } from "@/features/privacy/privacy-screen";
import { privacyView } from "@/features/privacy/privacy-view";
import { lockedScreen } from "@/features/vault/page-gate";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { findAppUserId } from "@/infrastructure/current-user";
import { dataMode } from "@/infrastructure/data-mode";
import {
  ledgerEntriesOf,
  ledgerEntriesWithRefs,
} from "@/infrastructure/disclosure-ledger-runtime";
import { listLearningConsentEntries } from "@/infrastructure/learning-consent-store";

/** Events listed with their references; totals cover every event. */
const LATEST_EVENTS = 100;

/**
 * Customize · Privacy: consent to learn from personal data, per use (#145),
 * and what left this machine (#140).
 */
export default async function CustomizePrivacyPage() {
  const locked = await lockedScreen();
  if (locked) return locked;
  const mode = dataMode();
  const actor = await resolveActorId();
  const userId =
    mode === "personal" && actor !== null ? await findAppUserId(actor) : null;
  const entries = userId === null ? [] : await listLearningConsentEntries(userId);
  const [all, latest] =
    actor === null
      ? [[], []]
      : await Promise.all([
          ledgerEntriesOf(actor),
          ledgerEntriesWithRefs(actor, LATEST_EVENTS),
        ]);
  return (
    <>
      <PrivacyScreen
        mode={mode}
        signedIn={actor !== null}
        views={privacyView(entries, new Date())}
      />
      <DisclosureSection view={ledgerView(all, latest)} />
    </>
  );
}
