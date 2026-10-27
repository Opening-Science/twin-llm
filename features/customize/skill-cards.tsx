import Link from "next/link";

import { skillSourceLabel, type TurnSkill } from "@/infrastructure/skill-gate";
import { draftHref } from "@/infrastructure/shell-links";

/**
 * The skills TwinLLM ships (`skills/<name>/SKILL.md`), as cards: what each
 * does, what it reads, which tools it may call and where its model runs.
 * That listing is the consent surface, the same one the `/` palette shows.
 * Try opens a new chat with `/name ` typed in; nothing is sent until you do.
 */

const providerLine = (providers: readonly string[]): string =>
  providers.length === 1 && providers[0] === "ollama"
    ? "runs on local models only"
    : `runs on: ${providers.join(", ")}`;

export const SkillCard = ({ skill }: Readonly<{ skill: TurnSkill }>) => (
  <li className="surface flex flex-col gap-3 p-4">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="font-mono text-sm">/{skill.name}</h3>
        <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
          {skill.description}
        </p>
      </div>
      <Link href={draftHref(skill.name)} className="chip shrink-0">
        Try
      </Link>
    </div>
    <dl className="text-muted-foreground grid gap-1 text-xs">
      <div className="flex gap-1.5">
        <dt>Reads</dt>
        <dd className="text-foreground">
          {skill.sources.map(skillSourceLabel).join(", ") || "nothing"}
        </dd>
      </div>
      <div className="flex gap-1.5">
        <dt>May call</dt>
        <dd className="text-foreground font-mono">
          {skill.tools.join(", ") || "no tools"}
        </dd>
      </div>
      <div>
        <dd>{providerLine(skill.providers)}</dd>
      </div>
    </dl>
  </li>
);

export const SkillGrid = ({ skills }: Readonly<{ skills: readonly TurnSkill[] }>) => (
  <ul className="mt-3 grid gap-3 sm:grid-cols-2">
    {skills.map((skill) => (
      <SkillCard key={skill.name} skill={skill} />
    ))}
  </ul>
);
