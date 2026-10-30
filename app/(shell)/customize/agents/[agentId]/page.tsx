import { notFound } from "next/navigation";

import { AgentScreen } from "@/features/agents/agent-screen";
import { loadRoster } from "@/features/agents/load-roster";
import { baseModelScores } from "@/features/agents/roster";
import { loadResults } from "@/features/lab/load-results";
import { runnableSkills } from "@/features/skills/load-skills";

/** One agent: its model, skill and tools, literature, routing and scores (#221). */
export default async function CustomizeAgentPage({
  params,
}: Readonly<{ params: Promise<{ agentId: string }> }>) {
  const { agentId } = await params;
  const [roster, results] = await Promise.all([
    loadRoster(runnableSkills()),
    loadResults(),
  ]);
  const entry = roster.entries.find(({ id }) => id === agentId);
  if (entry === undefined) notFound();
  return (
    <AgentScreen
      entry={entry}
      usageNote={roster.usageNote}
      scores={
        entry.baseModel === null ? [] : baseModelScores(results.runs, entry.baseModel.id)
      }
    />
  );
}
