import { redirect } from "next/navigation";

import { CompareScreen } from "@/features/arena/compare-screen";
import { skillCommand } from "@/features/commands/registry";
import { skillsFor } from "@/features/skills/user-skill-store";
import { findAppUserId } from "@/infrastructure/current-user";
import { needsOnboarding } from "@/features/onboarding/onboarding-store";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { fetchActiveModelCatalog } from "@/infrastructure/fetch-model-catalog";
import { serverEnv } from "@/infrastructure/env";
import { chatModelIsLocal } from "@/infrastructure/genome-gate";
import { INCOGNITO_PARAM, isIncognitoParam } from "@/infrastructure/incognito";
import { defaultModelSelection } from "@/infrastructure/model-catalog";
import { safeDraft } from "@/infrastructure/shell-links";

/**
 * A new thread. Someone who has not been through first-run setup and has no
 * thread yet goes to `/start` first; a signed-out visitor never does.
 *
 * `/?incognito=1` is a new chat that is never saved
 * (`infrastructure/incognito.ts`). The screen is keyed on the mode, so
 * switching it, or a reload, starts from an empty conversation. Only models
 * on this machine are offered there; with one provider active at a time,
 * that is every catalog model when the chat model is local, else none.
 */
export default async function HomePage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const actorId = await resolveActorId();
  if (actorId && (await needsOnboarding(actorId))) redirect("/start");

  const incognito = isIncognitoParam((await searchParams)[INCOGNITO_PARAM]);
  const catalog = await fetchActiveModelCatalog();
  const localModelIds = catalog && chatModelIsLocal() ? catalog.map(({ id }) => id) : [];
  const offered = incognito
    ? (catalog ?? []).filter(({ id }) => localModelIds.includes(id))
    : catalog;
  return (
    <CompareScreen
      key={incognito ? "incognito" : "new"}
      catalog={catalog}
      defaultModelIds={offered ? defaultModelSelection(offered) : []}
      skills={(
        await skillsFor(actorId === null ? null : await findAppUserId(actorId))
      ).map(skillCommand)}
      incognito={incognito}
      localModelIds={localModelIds}
      initialDraft={safeDraft((await searchParams).draft)}
      dataMode={serverEnv().DATA_MODE}
    />
  );
}
