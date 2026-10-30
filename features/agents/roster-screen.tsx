import Link from "next/link";

import { AUTO_AGENT } from "@/infrastructure/agents";
import { Card } from "@/infrastructure/ui-kit/card";

import { BaseModelText, costText, OfferBadge, SkillText, UsageText } from "./agent-parts";
import {
  articlesText,
  AUTO_DOES_NOT,
  shareText,
  toolsText,
  type AgentUsage,
  type RosterEntry,
} from "./roster";

/**
 * Customize · Agents (#221): every agent as a card, then Auto in plain
 * words. Each card opens the agent's own page with its tools, routing and
 * scores. Server-rendered.
 */

export type RouterScore = Readonly<{ name: string; right: number; total: number }>;

const AgentCard = ({ entry }: Readonly<{ entry: RosterEntry }>) => (
  <li className="surface flex flex-col gap-3 p-4">
    <div className="flex items-start justify-between gap-3">
      <h3 className="text-base font-medium">
        <Link href={`/customize/agents/${entry.id}`} className="hover:underline">
          {entry.name}
        </Link>
      </h3>
      <OfferBadge entry={entry} />
    </div>
    <p className="text-muted-foreground text-sm leading-relaxed">{entry.role}</p>
    <dl className="lab-evidence text-sm">
      <dt>Runs on</dt>
      <dd className="break-normal">
        <BaseModelText entry={entry} />
      </dd>
      <dt>Skill</dt>
      <dd>
        <SkillText entry={entry} />
        {entry.skill === null ? null : (
          <span className="text-muted-foreground">
            {" "}
            · {toolsText(entry.skill.tools.length)}
          </span>
        )}
      </dd>
      <dt>Literature</dt>
      <dd className="break-normal">
        {entry.literature.specialties.length > 1
          ? "Every specialty"
          : entry.literature.specialties.join(", ")}
        <span className="text-muted-foreground">
          {" "}
          · {articlesText(entry.literature.articles)}
        </span>
      </dd>
      <dt>Auto sends it</dt>
      <dd className="break-normal">{entry.topics.join("; ")}</dd>
      <dt>In your threads</dt>
      <dd className="break-normal">
        <UsageText usage={entry.usage} />
      </dd>
      <dt>Recorded cost</dt>
      <dd>{costText(entry.usage)}</dd>
    </dl>
    <p className="text-sm">
      <span className="text-muted-foreground">What it does not do: </span>
      {entry.doesNot}
    </p>
    <Link href={`/customize/agents/${entry.id}`} className="chip self-start">
      Tools, routing and scores
    </Link>
  </li>
);

const AutoSection = ({
  agents,
  usage,
  scores,
}: Readonly<{
  agents: readonly RosterEntry[];
  usage: AgentUsage;
  scores: readonly RouterScore[];
}>) => {
  const offered = agents.filter(({ offered }) => offered).map(({ name }) => name);
  return (
    <section aria-labelledby="auto" className="mt-10">
      <h2 id="auto" className="text-lg">
        {AUTO_AGENT.name}
      </h2>
      <p className="text-muted-foreground mt-1 text-sm">
        The first row of the picker. It is not an agent of its own: for each question it
        picks one of the agents above, and that agent answers.
      </p>
      <Card className="mt-3 flex flex-col gap-4">
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm leading-relaxed">
          <li>
            Auto reads the words of the question, not your data. No model is called to
            choose, so the same question always goes to the same agent.
          </li>
          <li>
            A question about a medicine or dose decision, or one that names a guideline,
            goes to General first. No specialist gives a dose, and only General searches
            the guideline library.
          </li>
          <li>
            Otherwise each specialist has a few topics, listed on its card as &ldquo;Auto
            sends it&rdquo;. The agent with the most matching topics answers; a tie goes
            to the one listed first.
          </li>
          <li>
            When nothing matches, or only an agent that is not offered here matches,
            General answers.
          </li>
          <li>
            The answer says who answered and why, for example &ldquo;Auto chose Sleep: the
            question is about sleep.&rdquo;
          </li>
        </ol>
        <dl className="lab-evidence">
          <dt>Offered here</dt>
          <dd className="break-normal">
            {offered.length === 0 ? "No agent" : offered.join(", ")}
          </dd>
          {scores.map((score) => (
            <div key={score.name} className="contents">
              <dt>{score.name}</dt>
              <dd className="break-normal">
                {shareText(score.right, score.total)} routed to the labelled agent
              </dd>
            </div>
          ))}
          <dt>In your threads</dt>
          <dd className="break-normal">
            <UsageText usage={usage} />
          </dd>
        </dl>
        <p className="text-muted-foreground text-xs leading-relaxed">
          The rules were tuned on these same questions, so they overstate how Auto does on
          new ones. Each agent&rsquo;s page shows its share per scenario.
        </p>
        <p className="text-sm">
          <span className="text-muted-foreground">What it does not do: </span>
          {AUTO_DOES_NOT}
        </p>
      </Card>
    </section>
  );
};

export const RosterScreen = ({
  entries,
  autoUsage,
  routerScores,
  note,
}: Readonly<{
  entries: readonly RosterEntry[];
  autoUsage: AgentUsage;
  routerScores: readonly RouterScore[];
  /** Why answer counts are missing, if they are. */
  note: string | null;
}>) => (
  <>
    <section aria-labelledby="agents">
      <h2 id="agents" className="text-lg">
        Agents
      </h2>
      <p className="text-muted-foreground mt-1 max-w-2xl text-sm leading-relaxed">
        Named presets over the models and skills TwinLLM already has. Each name says what
        part of the record or the literature an agent looks at, not a clinical role. They
        describe recorded data and published articles for research, and never say what a
        person has or should do.
      </p>
      {note === null ? null : (
        <p className="text-muted-foreground mt-2 text-sm">{note}</p>
      )}
      <ul className="mt-4 grid gap-3 md:grid-cols-2">
        {entries.map((entry) => (
          <AgentCard key={entry.id} entry={entry} />
        ))}
      </ul>
    </section>
    <AutoSection agents={entries} usage={autoUsage} scores={routerScores} />
  </>
);
