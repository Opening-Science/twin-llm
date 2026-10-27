import Link from "next/link";

import { SkillGrid } from "@/features/customize/skill-cards";
import { runnableSkills } from "@/features/skills/load-skills";
import { listUserSkills } from "@/features/skills/user-skill-store";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { findAppUserId } from "@/infrastructure/current-user";
import { draftHref } from "@/infrastructure/shell-links";

/** Customize · Skills: the person's own skills, and the ones TwinLLM ships. */
export default async function CustomizeSkillsPage() {
  const actor = await resolveActorId();
  const userId = actor === null ? null : await findAppUserId(actor);
  const yours = userId === null ? [] : await listUserSkills(userId);
  const shipped = runnableSkills();

  return (
    <>
      <section aria-labelledby="your-skills">
        <div className="flex items-center justify-between gap-4">
          <h2 id="your-skills" className="text-lg">
            Yours
          </h2>
          {actor !== null ? (
            <Link href="/customize/skills/new" className="chip">
              New skill
            </Link>
          ) : null}
        </div>
        {yours.length === 0 ? (
          <p className="text-muted-foreground mt-1 text-sm">
            {actor === null
              ? "Sign in to make your own skills."
              : "None yet. Name one, say what it should do, and pick what it may read and which tools it may call."}
          </p>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {yours.map((skill) => (
              <li key={skill.id} className="surface flex flex-col gap-2 p-4">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-mono text-sm">/{skill.name}</h3>
                  <span className="flex shrink-0 gap-2">
                    <Link href={draftHref(skill.name)} className="chip">
                      Try
                    </Link>
                    <Link href={`/customize/skills/${skill.id}`} className="chip">
                      Edit
                    </Link>
                  </span>
                </div>
                <p className="text-muted-foreground text-sm">{skill.description}</p>
                <p className="text-muted-foreground text-xs">Yours · not evaluated</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="shipped-skills" className="mt-10">
        <h2 id="shipped-skills" className="text-lg">
          Discover
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Skills that come with TwinLLM. Each passed its checks before it is listed here.
        </p>
        <SkillGrid skills={shipped} />
      </section>
    </>
  );
}
