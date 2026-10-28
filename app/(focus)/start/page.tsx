import { redirect } from "next/navigation";

import { connectGroups, sourceAvailability } from "@/features/onboarding/connect-rows";
import { OnboardingFlow } from "@/features/onboarding/onboarding-flow";
import {
  countIndexedDocuments,
  loadOnboardingOrEmpty,
} from "@/features/onboarding/onboarding-store";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { ensureAppUser, findAppUserId } from "@/infrastructure/current-user";
import {
  exoscalePersonalData,
  gbdEnv,
  isAuthDisabled,
  serverEnv,
} from "@/infrastructure/env";
import { genomeChatPermit } from "@/infrastructure/genome-gate";
import { importedDataChatPermit } from "@/infrastructure/imported-data-gate";
import { isLoopbackUrl } from "@/infrastructure/loopback";

import { loadConnectFacts } from "../../api/onboarding/connect-facts";
import { startStarterThread } from "./actions";

/**
 * First-run onboarding. The home page sends a person here until they
 * finish or skip it; the sidebar's Get started link opens it again later,
 * on the saved answers.
 */
export default async function StartPage() {
  const clerkId = await resolveActorId();
  if (!clerkId) redirect("/");

  const appUserId =
    (await findAppUserId(clerkId)) ??
    (isAuthDisabled() ? (await ensureAppUser(clerkId)).id : null);

  const env = serverEnv();
  const [stored, facts, documents] = await Promise.all([
    loadOnboardingOrEmpty(appUserId),
    loadConnectFacts(appUserId),
    countIndexedDocuments(),
  ]);

  return (
    <OnboardingFlow
      initialAnswers={stored.answers}
      // A finished flow reopens at the start; an unfinished one where it was left.
      initialStep={stored.completed ? 0 : stored.step}
      connectGroups={connectGroups(facts)}
      sourceAvailability={sourceAvailability({
        dataMode: env.DATA_MODE,
        guidelineDocuments: documents.guidelines,
        knowledgeDocuments: documents.knowledge,
        gbdConfigured: gbdEnv() !== null,
        genomeChat: genomeChatPermit().ok,
        importedChat: importedDataChatPermit().ok,
      })}
      residency={{
        localOnly: env.LOCAL_ONLY,
        provider: env.LLM_PROVIDER,
        dataMode: env.DATA_MODE,
        gbdConfigured: gbdEnv() !== null,
        ollamaOnLoopback: isLoopbackUrl(
          env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434/v1",
        ),
        exoscalePersonalData: exoscalePersonalData(env),
      }}
      onStartThread={startStarterThread}
    />
  );
}
