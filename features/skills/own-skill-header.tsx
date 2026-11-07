import Link from "next/link";

import { draftHref } from "@/infrastructure/shell-links";
import { BackLink } from "@/infrastructure/ui-kit/back-link";
import { Button } from "@/infrastructure/ui-kit/button";

import type { UserSkillRow } from "./user-skill";

/**
 * The top of your own skill's page (#486): back to Skills as on a shipped
 * skill's page, its name, Try and Delete. The delete action is passed in so
 * the header renders without the database.
 */
export const OwnSkillHeader = ({
  skill,
  deleteAction,
}: Readonly<{
  skill: Pick<UserSkillRow, "id" | "name">;
  deleteAction: (form: FormData) => Promise<void>;
}>) => (
  <div className="mb-6">
    <BackLink href="/customize">Skills</BackLink>
    <div className="mt-3 flex items-center justify-between gap-4">
      <h2 id="edit-skill" className="font-mono text-lg">
        /{skill.name}
      </h2>
      <div className="flex shrink-0 items-center gap-2">
        <Link href={draftHref(skill.name)} className="chip">
          Try
        </Link>
        <form action={deleteAction}>
          <input type="hidden" name="id" value={skill.id} />
          <Button type="submit" variant="ghost" className="text-destructive">
            Delete skill
          </Button>
        </form>
      </div>
    </div>
  </div>
);
