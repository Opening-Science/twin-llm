import Link from "next/link";

import { skillSourceLabel, type TurnSkill } from "@/infrastructure/skill-gate";
import { draftHref } from "@/infrastructure/shell-links";
import { toolDoes } from "@/infrastructure/tool-titles";
import { BackLink } from "@/infrastructure/ui-kit/back-link";
import { Card } from "@/infrastructure/ui-kit/card";

import { providerLine } from "./skill-card-lines";

/**
 * One shipped skill on its own page (#457): what it does, what it reads,
 * which tools it may use (in words, never ids) and where its model runs, the same words the `/`
 * palette shows. Try opens a new chat with `/name ` typed in; nothing is
 * sent until the person does.
 */
export const SkillDetail = ({ skill }: Readonly<{ skill: TurnSkill }>) => (
  <section aria-labelledby="skill">
    <BackLink href="/customize">Skills</BackLink>
    <div className="mt-3 flex items-start justify-between gap-4">
      <h2 id="skill" className="font-mono text-lg">
        /{skill.name}
      </h2>
      <Link href={draftHref(skill.name)} className="chip shrink-0">
        Try
      </Link>
    </div>
    <p className="text-muted-foreground mt-2 max-w-prose text-sm leading-relaxed">
      {skill.description}
    </p>
    <Card className="mt-4">
      <dl className="lab-evidence">
        <dt>Reads</dt>
        <dd className="break-normal">
          {skill.sources.map(skillSourceLabel).join(", ") || "nothing"}
        </dd>
        <dt>May use</dt>
        <dd className="break-normal">
          {skill.tools.map(toolDoes).join(", ") || "no tools"}
        </dd>
        <dt>Model</dt>
        <dd className="break-normal">{providerLine(skill.providers)}</dd>
      </dl>
    </Card>
    <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
      A skill that comes with TwinLLM passed its checks before it is listed. Try opens a
      new chat with the skill typed in; nothing is sent until you send it.
    </p>
  </section>
);
