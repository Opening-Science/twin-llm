import type { TurnSkill } from "@/infrastructure/skill-gate";
import { HubCard, HubGrid } from "@/infrastructure/ui-kit/hub-card";

import { OWN_SKILL_META, skillCardMeta, skillHref } from "./skill-card-lines";

/**
 * Skills as cards (#457): the name, what it does and how many tools it may
 * call, where its model runs. Each card opens the skill's own page, which
 * is the consent surface: what it reads, which tools it may call, and Try.
 * The shipped ones come from `skills/<name>/SKILL.md`; the person's own are
 * read from the database by the page.
 */

export type OwnSkill = Readonly<{ id: string; name: string; description: string }>;

export const SkillGrid = ({ skills }: Readonly<{ skills: readonly TurnSkill[] }>) => (
  <HubGrid label="Skills TwinLLM ships" className="mt-3">
    {skills.map((skill) => (
      <HubCard
        key={skill.name}
        href={skillHref(skill.name)}
        title={`/${skill.name}`}
        line={skill.description}
        meta={skillCardMeta(skill)}
      />
    ))}
  </HubGrid>
);

export const OwnSkillGrid = ({ skills }: Readonly<{ skills: readonly OwnSkill[] }>) => (
  <HubGrid label="Your skills" className="mt-3">
    {skills.map((skill) => (
      <HubCard
        key={skill.id}
        href={skillHref(skill.id)}
        title={`/${skill.name}`}
        line={skill.description}
        meta={OWN_SKILL_META}
      />
    ))}
  </HubGrid>
);
