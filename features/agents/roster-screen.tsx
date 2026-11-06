import { AUTO_AGENT } from "@/infrastructure/agents";
import { Card } from "@/infrastructure/ui-kit/card";
import { HubCard, HubGrid } from "@/infrastructure/ui-kit/hub-card";

import { offerLine, UsageText } from "./agent-parts";
import { AUTO_DOES_NOT, shareText, type AgentUsage, type RosterEntry } from "./roster";

/**
 * Customize · Agents (#221): every agent as a card (its name, its role and
 * whether it is offered here), then Auto in plain words. Each card opens
 * the agent's own page with its model, tools, routing and scores (#457).
 * Server-rendered.
 */

export type RouterScore = Readonly<{ name: string; right: number; total: number }>;

const AgentCard = ({ entry }: Readonly<{ entry: RosterEntry }>) => {
  const offer = offerLine(entry.offered);
  return (
    <HubCard
      href={`/customize/agents/${entry.id}`}
      title={entry.name}
      line={entry.role}
      meta={offer.text}
      tone={offer.tone}
    />
  );
};

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
            Otherwise each specialist has a few topics, listed on its page under
            &ldquo;What Auto sends it&rdquo;. The agent with the most matching topics
            answers; a tie goes to the one listed first.
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
      <HubGrid label="Agents" className="mt-4">
        {entries.map((entry) => (
          <AgentCard key={entry.id} entry={entry} />
        ))}
      </HubGrid>
    </section>
    <AutoSection agents={entries} usage={autoUsage} scores={routerScores} />
  </>
);
