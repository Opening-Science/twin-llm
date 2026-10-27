import { redirect } from "next/navigation";

import { CompareScreen } from "@/features/arena/compare-screen";
import { skillCommand } from "@/features/commands/registry";
import { skillsFor } from "@/features/skills/user-skill-store";
import { findAppUserId } from "@/infrastructure/current-user";
import { needsOnboarding } from "@/features/onboarding/onboarding-store";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { fetchActiveModelCatalog } from "@/infrastructure/fetch-model-catalog";
import { serverEnv } from "@/infrastructure/env";
import { defaultModelSelection } from "@/infrastructure/model-catalog";
import { safeDraft } from "@/infrastructure/shell-links";

/**
 * A new thread. Someone who has not been through first-run setup and has no
 * thread yet goes to `/start` first; a signed-out visitor never does.
 */
export default async function HomePage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const actorId = await resolveActorId();
  if (actorId && (await needsOnboarding(actorId))) redirect("/start");

  const catalog = await fetchActiveModelCatalog();
  return (
    <CompareScreen
      catalog={catalog}
      defaultModelIds={catalog ? defaultModelSelection(catalog) : []}
      skills={(
        await skillsFor(actorId === null ? null : await findAppUserId(actorId))
      ).map(skillCommand)}
      initialDraft={safeDraft((await searchParams).draft)}
      dataMode={serverEnv().DATA_MODE}
    />
  );
}
