import { notFound } from "next/navigation";

import { removeSkill } from "@/features/skills/skill-actions";
import { SkillForm } from "@/features/skills/skill-form";
import { getUserSkill } from "@/features/skills/user-skill-store";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { findAppUserId } from "@/infrastructure/current-user";
import { Button } from "@/infrastructure/ui-kit/button";

/** Edit one of your own skills; anyone else's id is a 404. */
export default async function EditSkillPage({
  params,
}: Readonly<{ params: Promise<{ skillId: string }> }>) {
  const { skillId } = await params;
  const actor = await resolveActorId();
  const userId = actor === null ? null : await findAppUserId(actor);
  const skill = userId === null ? null : await getUserSkill(userId, skillId);
  if (skill === null) notFound();

  return (
    <section aria-labelledby="edit-skill">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h2 id="edit-skill" className="font-mono text-lg">
          /{skill.name}
        </h2>
        <form action={removeSkill}>
          <input type="hidden" name="id" value={skill.id} />
          <Button type="submit" variant="ghost" className="text-destructive">
            Delete skill
          </Button>
        </form>
      </div>
      <SkillForm skill={skill} />
    </section>
  );
}
