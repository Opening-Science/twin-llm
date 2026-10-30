import Link from "next/link";
import type { ReactNode } from "react";

import { formatDate } from "@/infrastructure/format-measure";
import { Card } from "@/infrastructure/ui-kit/card";

import { BaseModelText, costText, OfferBadge, SkillText, UsageText } from "./agent-parts";
import {
  articlesText,
  type BaseModelScores,
  type RosterEntry,
  routedText,
  routingTotal,
  scoreText,
} from "./roster";

/**
 * One agent's page (#221): what it runs on, its skill and tools, its
 * literature, the questions Auto sends it and how that measures, the base
 * model's evaluation scores, and its answers in the viewer's threads.
 * Server-rendered.
 */

const Section = ({
  id,
  title,
  children,
}: Readonly<{ id: string; title: string; children: ReactNode }>) => (
  <section aria-labelledby={id} className="mt-8">
    <h3 id={id} className="text-base font-medium">
      {title}
    </h3>
    <Card className="mt-2 flex flex-col gap-3">{children}</Card>
  </section>
);

const Muted = ({ children }: Readonly<{ children: ReactNode }>) => (
  <p className="text-muted-foreground text-sm leading-relaxed">{children}</p>
);

const SkillSection = ({ entry }: Readonly<{ entry: RosterEntry }>) => (
  <Section id="skill" title="Skill and tools">
    {entry.skillName === null ? (
      <Muted>
        No skill of its own, so no tool list of its own: a turn gets the same tools a
        plain model gets in the chat, and the knowledge sources you turned on.
      </Muted>
    ) : entry.skill === null ? (
      <Muted>
        Its skill, <span className="font-mono">/{entry.skillName}</span>, is not offered
        by this server, so the agent is left out of the picker.
      </Muted>
    ) : (
      <dl className="lab-evidence">
        <dt>Skill</dt>
        <dd>
          <SkillText entry={entry} />
        </dd>
        <dt>Reads</dt>
        <dd className="break-normal">{entry.skill.sources.join(", ") || "nothing"}</dd>
        <dt>May call</dt>
        <dd className="font-mono text-xs leading-relaxed break-normal">
          {entry.skill.tools.join(", ") || "no tools"}
        </dd>
        <dt>Where it runs</dt>
        <dd className="break-normal">
          {entry.skill.localOnly ? "Local models only" : "As the skill lists"}
        </dd>
      </dl>
    )}
    {entry.skillName === null ? null : (
      <Muted>
        A <span className="font-mono">/skill</span> typed in the prompt wins over the
        agent&rsquo;s own. The skill goes through the same checks either way.
      </Muted>
    )}
  </Section>
);

const LiteratureSection = ({ entry }: Readonly<{ entry: RosterEntry }>) => (
  <Section id="literature" title="Literature">
    <dl className="lab-evidence">
      <dt>Specialty</dt>
      <dd className="break-normal">{entry.literature.specialties.join(", ")}</dd>
      <dt>In the local index</dt>
      <dd>
        {entry.literature.articles === null
          ? "Could not be read just now"
          : articlesText(entry.literature.articles)}
      </dd>
    </dl>
    <Muted>
      Open-access articles from PubMed Central, each under its own licence, searched by{" "}
      <span className="font-mono">knowledge_search</span> on this agent&rsquo;s turns.
      Reference material, never a statement about the person.
      {entry.literature.articles === 0 ? (
        <>
          {" "}
          None is on this machine yet;{" "}
          <code className="setup-code">bun run literature:ingest</code> adds what{" "}
          <code className="setup-code">literature:fetch</code> downloaded.
        </>
      ) : null}
    </Muted>
  </Section>
);

const RoutingSection = ({ entry }: Readonly<{ entry: RosterEntry }>) => {
  const total = routingTotal(entry.routing);
  return (
    <Section id="routing" title="What Auto sends it">
      <p className="text-sm leading-relaxed">
        Questions about {entry.topics.join("; ")}.
      </p>
      {entry.routing.length === 0 ? (
        <Muted>No router test question is labelled for this agent yet.</Muted>
      ) : (
        <div className="lab-table-wrap">
          <table className="lab-table">
            <caption className="sr-only">
              Router test questions for {entry.name}, per scenario
            </caption>
            <thead>
              <tr>
                <th scope="col">Scenario</th>
                <th scope="col">Labelled here, sent here</th>
                <th scope="col">Labelled elsewhere, sent here</th>
              </tr>
            </thead>
            <tbody>
              {[...entry.routing, total].map((cell) => (
                <tr key={cell.scenario}>
                  <th scope="row">{cell.scenario}</th>
                  <td>{routedText(cell)}</td>
                  <td>{cell.strays}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Muted>
        From the router&rsquo;s test files: the 130 scored evaluation questions of the v1
        set, each labelled from the tools and codes it needs, and a short hand-written
        set. The rules were tuned on them, so new questions will do worse.
      </Muted>
    </Section>
  );
};

const ScoresTable = ({ scores }: Readonly<{ scores: BaseModelScores }>) => (
  <div className="flex min-w-0 flex-col gap-2">
    <h4 className="text-sm font-medium break-all">
      {scores.runId}
      <span className="text-muted-foreground font-normal">
        {" "}
        · {scores.model}
        {scores.date === null ? null : ` · ${formatDate(scores.date)}`}
      </span>
    </h4>
    <div className="lab-table-wrap">
      <table className="lab-table">
        <caption className="sr-only">Pass rates of {scores.model}</caption>
        <thead>
          <tr>
            <th scope="col">Criterion</th>
            {scores.columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {scores.rows.map((row) => (
            <tr key={row.criterion}>
              <th scope="row">{row.criterion}</th>
              {row.cells.map((cell, index) => (
                <td key={scores.columns[index] ?? index}>{scoreText(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

const ScoresSection = ({
  entry,
  scores,
}: Readonly<{ entry: RosterEntry; scores: readonly BaseModelScores[] }>) => (
  <Section id="scores" title="Evaluation of its base model">
    <Muted>
      The evaluation harness calls the base model, not the agent, so these are the
      model&rsquo;s pass rates per scenario without this agent&rsquo;s skill or
      literature. Passes over scored answers, with the Wilson 95 % interval, on synthetic
      people only.
    </Muted>
    {entry.baseModel === null ? (
      <Muted>Not offered here, so there is no base model to look up.</Muted>
    ) : scores.length === 0 ? (
      <Muted>
        No evaluation run of <span className="font-mono">{entry.baseModel.id}</span> on
        this machine. The{" "}
        <Link href="/lab#results" className="underline">
          Lab&rsquo;s Results
        </Link>{" "}
        say how to make one.
      </Muted>
    ) : (
      scores.map((table) => <ScoresTable key={table.runId} scores={table} />)
    )}
  </Section>
);

const UsageSection = ({
  entry,
  note,
}: Readonly<{ entry: RosterEntry; note: string | null }>) => (
  <Section id="usage" title="In your threads">
    {note === null ? (
      <dl className="lab-evidence">
        <dt>Answers</dt>
        <dd className="break-normal">
          <UsageText usage={entry.usage} />
        </dd>
        <dt>Recorded cost</dt>
        <dd>{costText(entry.usage)}</dd>
      </dl>
    ) : (
      <Muted>{note}</Muted>
    )}
  </Section>
);

export const AgentScreen = ({
  entry,
  scores,
  usageNote,
}: Readonly<{
  entry: RosterEntry;
  scores: readonly BaseModelScores[];
  usageNote: string | null;
}>) => (
  <article aria-labelledby="agent-name">
    <Link
      href="/customize/agents"
      className="text-muted-foreground hover:text-foreground text-sm"
    >
      ← All agents
    </Link>
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
      <h2 id="agent-name" className="text-lg">
        {entry.name}
      </h2>
      <OfferBadge entry={entry} />
    </div>
    <p className="mt-1 max-w-2xl text-sm leading-relaxed">{entry.role}</p>
    <p className="mt-2 max-w-2xl text-sm leading-relaxed">
      <span className="text-muted-foreground">What it does not do: </span>
      {entry.doesNot}
    </p>
    <Section id="model" title="Model">
      <dl className="lab-evidence">
        <dt>Runs on here</dt>
        <dd className="break-normal">
          <BaseModelText entry={entry} />
        </dd>
        <dt>Prefers</dt>
        <dd className="break-normal">
          <span className="font-mono">{entry.modelPreference.join(", then ")}</span>, then
          the first model the provider offers
        </dd>
      </dl>
    </Section>
    <SkillSection entry={entry} />
    <LiteratureSection entry={entry} />
    <RoutingSection entry={entry} />
    <ScoresSection entry={entry} scores={scores} />
    <UsageSection entry={entry} note={usageNote} />
  </article>
);
