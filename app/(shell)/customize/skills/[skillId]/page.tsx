import { notFound } from "next/navigation";

import { SkillDetail } from "@/features/customize/skill-detail";
import { findRunnableSkill } from "@/features/skills/load-skills";
import { OwnSkillHeader } from "@/features/skills/own-skill-header";
import { removeSkill } from "@/features/skills/skill-actions";
import { SkillForm } from "@/features/skills/skill-form";
import { getUserSkill } from "@/features/skills/user-skill-store";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { findAppUserId } from "@/infrastructure/current-user";

/**
 * One skill's page: a shipped skill by its name, read-only (#457); your own
 * skill by its id, to edit. The shipped list is read first, so a shipped
 * name needs no query and its page works when the skill table cannot be
 * read. Ids are cuids and names are words, so the order finds the same
 * skill. Anyone else's id, or an unknown name, is a 404.
 */
export default async function SkillPage({
  params,
}: Readonly<{ params: Promise<{ skillId: string }> }>) {
  const { skillId } = await params;
  const shipped = findRunnableSkill(skillId);
  if (shipped !== null) return <SkillDetail skill={shipped} />;

  const actor = await resolveActorId();
  const userId = actor === null ? null : await findAppUserId(actor);
  const skill = userId === null ? null : await getUserSkill(userId, skillId);
  if (skill === null) notFound();

  return (
    <section aria-labelledby="edit-skill">
      <OwnSkillHeader skill={skill} deleteAction={removeSkill} />
      <SkillForm skill={skill} />
    </section>
  );
}
