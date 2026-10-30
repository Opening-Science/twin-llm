import { loadRoster } from "@/features/agents/load-roster";
import { routerAccuracy } from "@/features/agents/roster";
import { RosterScreen } from "@/features/agents/roster-screen";
import { HAND_WRITTEN_ITEMS, QUESTION_ITEMS } from "@/features/agents/router-fixtures";
import { runnableSkills } from "@/features/skills/load-skills";

/** Customize · Agents (#221): every agent, and Auto in plain words. */
export default async function CustomizeAgentsPage() {
  const roster = await loadRoster(runnableSkills());
  return (
    <RosterScreen
      entries={roster.entries}
      autoUsage={roster.autoUsage}
      note={roster.usageNote}
      routerScores={[
        { name: "Scored questions", ...routerAccuracy(QUESTION_ITEMS) },
        { name: "Hand-written prompts", ...routerAccuracy(HAND_WRITTEN_ITEMS) },
      ]}
    />
  );
}
