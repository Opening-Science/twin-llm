import { skillSourceLabel, type TurnSkill } from "@/infrastructure/skill-gate";

/**
 * The commands behind `/` in the prompt bar: built-ins, then the skills the
 * server offers (#41, #42). Each says what it reads before it runs; a skill
 * also names the tools it may call. That listing is the consent surface.
 */

export type Command = Readonly<{
  name: string;
  description: string;
  reads: readonly string[];
  /** A skill's tools, shown before it runs. Built-ins have none. */
  tools?: readonly string[];
  kind?: "built-in" | "skill";
}>;

export const BUILT_IN_COMMANDS: readonly Command[] = [
  { name: "connect", description: "Connect a wearable", reads: [] },
];

/** A runnable skill as the palette lists it: sources by their labels, tools by name. */
export const skillCommand = (
  skill: Pick<TurnSkill, "name" | "description" | "sources" | "tools">,
): Command => ({
  name: skill.name,
  description: skill.description,
  reads: skill.sources.map(skillSourceLabel),
  tools: [...skill.tools],
  kind: "skill",
});

/** Built-ins first; a skill may not take a built-in's name. */
export const paletteCommands = (skills: readonly Command[]): readonly Command[] => [
  ...BUILT_IN_COMMANDS,
  ...skills.filter(
    (skill) => !BUILT_IN_COMMANDS.some((command) => command.name === skill.name),
  ),
];

export const matchCommands = (
  query: string,
  commands: readonly Command[],
): readonly Command[] => {
  const prefix = query.toLowerCase();
  return commands.filter((command) => command.name.toLowerCase().startsWith(prefix));
};

export const readsLine = (reads: readonly string[]): string =>
  reads.length === 0 ? "reads nothing" : `reads: ${reads.join(", ")}`;

export const toolsLine = (tools: readonly string[]): string =>
  tools.length === 0 ? "calls no tools" : `may call: ${tools.join(", ")}`;

const SKILL_DRAFT = /^\/([a-z][a-z0-9-]*)(?:\s+([\s\S]*))?$/;

export type SkillDraft = Readonly<{ skill: Command; prompt: string }>;

/**
 * A draft that starts with a listed skill (`/sleep last 30 nights`): the
 * skill and the rest of the text. With nothing after the name the prompt is
 * the skill's own description, so the model still has a question. Anything
 * else, including an unknown `/word`, is an ordinary prompt: null.
 */
export const skillDraft = (
  draft: string,
  skills: readonly Command[],
): SkillDraft | null => {
  const match = SKILL_DRAFT.exec(draft.trim());
  if (match === null) return null;
  const skill = skills.find(
    (command) => command.kind === "skill" && command.name === match[1],
  );
  if (skill === undefined) return null;
  const rest = (match[2] ?? "").trim();
  return { skill, prompt: rest === "" ? skill.description : rest };
};
