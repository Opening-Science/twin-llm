import "server-only";

import { database } from "@/infrastructure/database";
import type { TurnSkill } from "@/infrastructure/skill-gate";

import { findRunnableSkill, runnableSkills } from "./load-skills";
import { type UserSkillInput, type UserSkillRow, userTurnSkill } from "./user-skill";

/**
 * Where a person's own skills (#174) are kept. Every read and write filters
 * on the owner; nobody else can list, run, change or delete them.
 */

const FIELDS = {
  id: true,
  name: true,
  description: true,
  instructions: true,
  tools: true,
  sources: true,
  providers: true,
  views: true,
} as const;

export const listUserSkills = async (userId: string): Promise<readonly UserSkillRow[]> =>
  database().userSkill.findMany({
    where: { userId },
    select: FIELDS,
    orderBy: { name: "asc" },
    take: 100,
  });

export const getUserSkill = async (
  userId: string,
  id: string,
): Promise<UserSkillRow | null> =>
  database().userSkill.findFirst({ where: { id, userId }, select: FIELDS });

/** The person's skills that pass today's rules, as the chat runs them. */
export const userTurnSkills = async (userId: string): Promise<readonly TurnSkill[]> =>
  (await listUserSkills(userId)).flatMap((row) => {
    const skill = userTurnSkill(row);
    return skill === null ? [] : [skill];
  });

/** A shipped skill by name, else the person's own; null when neither runs. */
export const findSkillFor = async (
  name: string,
  userId: string | null,
): Promise<TurnSkill | null> => {
  const shipped = findRunnableSkill(name);
  if (shipped !== null || userId === null) return shipped;
  const row = await database().userSkill.findUnique({
    where: { userId_name: { userId, name } },
    select: FIELDS,
  });
  return row === null ? null : userTurnSkill(row);
};

/** Shipped skills, then the person's own, as the palette and search list them. */
export const skillsFor = async (userId: string | null): Promise<readonly TurnSkill[]> => [
  ...runnableSkills(),
  ...(userId === null ? [] : await userTurnSkills(userId)),
];

const data = (skill: UserSkillInput) => ({
  name: skill.frontmatter.name,
  description: skill.frontmatter.description,
  instructions: skill.instructions,
  tools: [...skill.frontmatter.tools],
  sources: [...skill.frontmatter.sources],
  providers: [...skill.frontmatter.providers],
  views: [...skill.frontmatter.views],
});

export const countUserSkills = async (userId: string): Promise<number> =>
  database().userSkill.count({ where: { userId } });

export const createUserSkill = async (userId: string, skill: UserSkillInput) =>
  database().userSkill.create({ data: { userId, ...data(skill) }, select: { id: true } });

/** Updates only the owner's row; returns false when there is none. */
export const updateUserSkill = async (
  userId: string,
  id: string,
  skill: UserSkillInput,
): Promise<boolean> =>
  (await database().userSkill.updateMany({ where: { id, userId }, data: data(skill) }))
    .count === 1;

export const deleteUserSkill = async (userId: string, id: string): Promise<boolean> =>
  (await database().userSkill.deleteMany({ where: { id, userId } })).count === 1;
