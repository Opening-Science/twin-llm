import "server-only";

import { join } from "node:path";

import type { TurnSkill } from "@/infrastructure/skill-gate";

import { checkSkills, readSyntheticSubjects } from "./read-skills";
import type { Skill } from "./skill-schema";

/**
 * The skills the app offers: every folder under `skills/` that validates and
 * whose eval cases all pass. A skill that fails either is left out, so the
 * palette never lists it and the chat route never runs it; the reason goes to
 * the server log.
 *
 * Read on first use and kept for the life of the process in production. In
 * development it is read again on every call, so an edited SKILL.md shows up
 * without a restart.
 */

export type SkillsRoot = Readonly<{ skillsDir: string; questionsPath: string }>;

/** Pure over the files: the runnable skills under one root, in folder order. */
export const runnableSkillsIn = (root: SkillsRoot): readonly Skill[] => {
  const check = checkSkills(root.skillsDir, readSyntheticSubjects(root.questionsPath));
  const failing = new Set(
    check.results.filter((result) => !result.passed).map((result) => result.skill),
  );
  check.errors.forEach((error) => console.error(`[skills] ${error}`));
  failing.forEach((name) => console.error(`[skills] ${name}: an eval case fails`));
  return check.valid.filter((skill) => !failing.has(skill.name));
};

const appRoot = (): SkillsRoot => ({
  skillsDir: join(process.cwd(), "skills"),
  questionsPath: join(process.cwd(), "evaluation", "questions.v1.json"),
});

const cache: { skills: readonly Skill[] | null } = { skills: null };

/** Every runnable skill, as the chat runs it. */
export const runnableSkills = (): readonly TurnSkill[] => {
  if (process.env.NODE_ENV !== "production") return runnableSkillsIn(appRoot());
  // A one-slot cache filled on first read; nothing else writes it.
  Object.assign(cache, { skills: cache.skills ?? runnableSkillsIn(appRoot()) });
  return cache.skills ?? [];
};

/** The runnable skill with this name, or null. */
export const findRunnableSkill = (name: string): TurnSkill | null =>
  runnableSkills().find((skill) => skill.name === name) ?? null;
