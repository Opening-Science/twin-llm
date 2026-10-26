import type { Metadata } from "next";

import { CompareScreen } from "@/features/arena/compare-screen";
import { skillCommand } from "@/features/commands/registry";
import { runnableSkills } from "@/features/skills/load-skills";
import { ownedThread } from "@/features/arena/thread-reads";
import { ThreadTitle } from "@/features/shell/thread-title";
import { fetchActiveModelCatalog } from "@/infrastructure/fetch-model-catalog";
import { defaultModelSelection } from "@/infrastructure/model-catalog";

/** A thread is private to its owner; search engines get nothing either way. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * A saved thread, for its owner only (`owned-thread.ts`). Anyone else gets the
 * same 404 as an id that never existed; `layout.tsx` has already settled that
 * before this renders. A follow-up goes to the models the last turn used, so
 * the thread carries on where it stopped.
 */
export default async function ThreadPage({
  params,
}: Readonly<{ params: Promise<{ threadId: string }> }>) {
  const { threadId } = await params;
  const [thread, catalog] = await Promise.all([
    ownedThread(threadId),
    fetchActiveModelCatalog(),
  ]);

  const lastTurn = thread.turns.at(-1);
  const defaultModelIds = lastTurn
    ? lastTurn.answers.map((response) => response.modelId)
    : catalog
      ? defaultModelSelection(catalog)
      : [];

  return (
    <>
      <ThreadTitle threadId={thread.id} title={thread.title} />
      <CompareScreen
        key={thread.id}
        catalog={catalog}
        defaultModelIds={defaultModelIds}
        threadId={thread.id}
        initialTurns={thread.turns}
        skills={runnableSkills().map(skillCommand)}
      />
    </>
  );
}
