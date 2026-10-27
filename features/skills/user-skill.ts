import { z } from "zod";

import type { TurnSkill } from "@/infrastructure/skill-gate";

import { skillFrontmatterSchema } from "./skill-schema";

/**
 * A skill a person makes on Customize (#174): the fields of a SKILL.md
 * frontmatter plus its instructions, held to the same schema, so a made
 * skill can do nothing a shipped one could not. It may only narrow what a
 * turn already allows; the data-mode and genome policies still run.
 *
 * It may not take the name of a shipped skill or a built-in command, so `/sleep`
 * always means the shipped one. It has no eval cases; the palette says it is
 * the person's own and not evaluated.
 */

export const USER_SKILL_INSTRUCTIONS_MAX = 4000;
/** Skills one person may keep. */
export const USER_SKILL_LIMIT = 50;

export const userSkillInputSchema = z.strictObject({
  frontmatter: skillFrontmatterSchema,
  instructions: z
    .string()
    .trim()
    .min(1, { error: "say what the skill should do" })
    .max(USER_SKILL_INSTRUCTIONS_MAX, {
      error: `instructions are at most ${USER_SKILL_INSTRUCTIONS_MAX} characters`,
    }),
});

export type UserSkillInput = z.infer<typeof userSkillInputSchema>;

export type UserSkillRow = Readonly<{
  id: string;
  name: string;
  description: string;
  instructions: string;
  tools: readonly string[];
  sources: readonly string[];
  providers: readonly string[];
  views: readonly string[];
}>;

export type FieldErrors = Readonly<Record<string, string>>;

/** Zod issues as one message per form field (`tools`, `sources.2` → `sources`). */
export const fieldErrors = (error: z.ZodError): FieldErrors =>
  Object.fromEntries(
    error.issues
      .map((issue) => {
        const path = issue.path.map(String);
        const field =
          path[0] === "frontmatter" ? (path[1] ?? "form") : (path[0] ?? "form");
        return [field, issue.message] as const;
      })
      .reverse(),
  );

export type CheckedUserSkill =
  | Readonly<{ ok: true; skill: UserSkillInput }>
  | Readonly<{ ok: false; errors: FieldErrors }>;

/** Checks a submitted form, including that the name is free. */
export const checkUserSkill = (
  raw: unknown,
  takenNames: ReadonlySet<string>,
): CheckedUserSkill => {
  const parsed = userSkillInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  if (takenNames.has(parsed.data.frontmatter.name)) {
    return {
      ok: false,
      errors: { name: "a shipped skill or command already has this name" },
    };
  }
  return { ok: true, skill: parsed.data };
};

/**
 * A stored skill as the chat runs it, checked again: a row written before a
 * rule tightened, or edited by hand, never runs outside today's rules.
 */
export const userTurnSkill = (row: UserSkillRow): TurnSkill | null => {
  const checked = userSkillInputSchema.safeParse({
    frontmatter: {
      name: row.name,
      description: row.description,
      tools: [...row.tools],
      sources: [...row.sources],
      providers: [...row.providers],
      views: [...row.views],
    },
    instructions: row.instructions,
  });
  if (!checked.success) return null;
  const { frontmatter, instructions } = checked.data;
  return { ...frontmatter, instructions };
};
