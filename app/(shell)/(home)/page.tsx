import { redirect } from "next/navigation";

import { CompareScreen } from "@/features/arena/compare-screen";
import { skillCommand } from "@/features/commands/registry";
import { runnableSkills } from "@/features/skills/load-skills";
import { needsOnboarding } from "@/features/onboarding/onboarding-store";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { fetchActiveModelCatalog } from "@/infrastructure/fetch-model-catalog";
import { serverEnv } from "@/infrastructure/env";
import { defaultModelSelection } from "@/infrastructure/model-catalog";

/**
 * A new thread. Someone who has not been through first-run setup and has no
 * thread yet goes to `/start` first; a signed-out visitor never does.
 */
export default async function HomePage() {
  const actorId = await resolveActorId();
  if (actorId && (await needsOnboarding(actorId))) redirect("/start");

  const catalog = await fetchActiveModelCatalog();
  return (
    <CompareScreen
      catalog={catalog}
      defaultModelIds={catalog ? defaultModelSelection(catalog) : []}
      skills={runnableSkills().map(skillCommand)}
      dataMode={serverEnv().DATA_MODE}
    />
  );
}
