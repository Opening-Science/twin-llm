"use server";

import { redirect } from "next/navigation";

import { Prisma } from "@/generated/prisma/client";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { ensureAppUser } from "@/infrastructure/current-user";

import { runnableSkills } from "./load-skills";
import { checkUserSkill, type FieldErrors, USER_SKILL_LIMIT } from "./user-skill";
import {
  countUserSkills,
  createUserSkill,
  deleteUserSkill,
  updateUserSkill,
} from "./user-skill-store";

/**
 * Saving and deleting a person's own skill (#174). The form posts here; the
 * same schema as a SKILL.md decides what is allowed, and only the owner's row
 * is ever changed.
 */

/** Built-in `/` commands; a skill may not shadow one. */
const BUILT_IN_NAMES = ["connect", "twin", "compact"] as const;

export type SkillFormState = Readonly<{ errors: FieldErrors }>;

const COPY = {
  signIn: "Sign in to make your own skills.",
  limit: `You can keep at most ${USER_SKILL_LIMIT} skills; delete one first.`,
  duplicate: "You already have a skill with this name.",
  gone: "This skill no longer exists.",
  failed: "The skill wasn't saved. Try again.",
} as const;

const list = (form: FormData, key: string): string[] =>
  form.getAll(key).filter((value): value is string => typeof value === "string");

const text = (form: FormData, key: string): string => {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
};

/** The form as the schema reads it. Providers start local only when none is ticked. */
export const formToRaw = async (form: FormData) => {
  const providers = list(form, "providers");
  return {
    frontmatter: {
      name: text(form, "name").trim(),
      description: text(form, "description").trim(),
      tools: list(form, "tools"),
      sources: list(form, "sources"),
      providers: providers.length === 0 ? ["ollama"] : providers,
      views: list(form, "views"),
    },
    instructions: text(form, "instructions"),
  };
};

const ownerId = async (): Promise<string | null> => {
  const actor = await resolveActorId();
  return actor === null ? null : (await ensureAppUser(actor)).id;
};

export const saveSkill = async (
  _previous: SkillFormState,
  form: FormData,
): Promise<SkillFormState> => {
  const userId = await ownerId();
  if (userId === null) return { errors: { form: COPY.signIn } };

  const taken = new Set<string>([
    ...BUILT_IN_NAMES,
    ...runnableSkills().map((skill) => skill.name),
  ]);
  const checked = checkUserSkill(await formToRaw(form), taken);
  if (!checked.ok) return { errors: checked.errors };

  const id = text(form, "id");
  try {
    if (id === "") {
      if ((await countUserSkills(userId)) >= USER_SKILL_LIMIT) {
        return { errors: { form: COPY.limit } };
      }
      await createUserSkill(userId, checked.skill);
    } else if (!(await updateUserSkill(userId, id, checked.skill))) {
      return { errors: { form: COPY.gone } };
    }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { errors: { name: COPY.duplicate } };
    }
    console.error(
      "[skills] could not save a skill",
      error instanceof Error ? error.name : "",
    );
    return { errors: { form: COPY.failed } };
  }
  redirect("/customize");
};

export const removeSkill = async (form: FormData): Promise<void> => {
  const userId = await ownerId();
  const id = text(form, "id");
  if (userId !== null && id !== "") await deleteUserSkill(userId, id);
  redirect("/customize");
};
