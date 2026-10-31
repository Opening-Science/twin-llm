import { PrivacyScreen } from "@/features/privacy/privacy-screen";
import { privacyView } from "@/features/privacy/privacy-view";
import { lockedScreen } from "@/features/vault/page-gate";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { findAppUserId } from "@/infrastructure/current-user";
import { dataMode } from "@/infrastructure/data-mode";
import { listLearningConsentEntries } from "@/infrastructure/learning-consent-store";

/** Customize · Privacy (#145): consent to learn from personal data, per use. */
export default async function CustomizePrivacyPage() {
  const locked = await lockedScreen();
  if (locked) return locked;
  const mode = dataMode();
  const actor = await resolveActorId();
  const userId =
    mode === "personal" && actor !== null ? await findAppUserId(actor) : null;
  const entries = userId === null ? [] : await listLearningConsentEntries(userId);
  return (
    <PrivacyScreen
      mode={mode}
      signedIn={actor !== null}
      views={privacyView(entries, new Date())}
    />
  );
}
