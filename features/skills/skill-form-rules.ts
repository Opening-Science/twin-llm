import { ALL_KNOWLEDGE_SOURCES } from "@/infrastructure/knowledge-sources";
import { skillSourceLabel } from "@/infrastructure/skill-gate";

import { SKILL_SOURCE_IDS, sourceRequires, toolOwner } from "./skill-schema";

/**
 * What ticking a source or a tool does in the skill form (#486), using the
 * same relations the schema checks on save: a tool needs the source that owns
 * it, and a source needs the source it `requires`. A knowledge source is read
 * only through its tools, so a freshly ticked one gets all of them; a person
 * may untick them again (the schema allows it), and `unreadSources` names the
 * sources that then read nothing so the form can say so. Pure.
 */

export type SkillSelection = Readonly<{
  sources: readonly string[];
  tools: readonly string[];
}>;

const SOURCE_TOOLS: ReadonlyMap<string, readonly string[]> = new Map(
  ALL_KNOWLEDGE_SOURCES.map((source) => [source.id, source.tools] as const),
);

const sourceTools = (id: string): readonly string[] => SOURCE_TOOLS.get(id) ?? [];

const unique = (items: readonly string[]): string[] => [...new Set(items)];

/** `id` and every source it needs, nearest first. */
const withRequired = (id: string): readonly string[] => {
  const required = sourceRequires(id);
  return required === undefined ? [id] : [id, ...withRequired(required)];
};

/** Every source that needs `id`, directly or through another. */
const dependents = (id: string): readonly string[] =>
  SKILL_SOURCE_IDS.filter((source) => source !== id && withRequired(source).includes(id));

/** Adds sources; one newly ticked with none of its tools ticked gets all of them. */
const addSources = (
  selection: SkillSelection,
  ids: readonly string[],
): SkillSelection => {
  const fresh = ids.filter((id) => !selection.sources.includes(id));
  const filled = fresh.filter(
    (id) => !sourceTools(id).some((tool) => selection.tools.includes(tool)),
  );
  return {
    sources: unique([...selection.sources, ...ids]),
    tools: unique([...selection.tools, ...filled.flatMap(sourceTools)]),
  };
};

export const tickSource = (
  selection: SkillSelection,
  id: string,
  on: boolean,
): SkillSelection => {
  if (on) return addSources(selection, withRequired(id));
  const removed = new Set([id, ...dependents(id)]);
  return {
    sources: selection.sources.filter((source) => !removed.has(source)),
    tools: selection.tools.filter((tool) => {
      const owner = toolOwner(tool);
      return owner === undefined || !removed.has(owner);
    }),
  };
};

export const tickTool = (
  selection: SkillSelection,
  tool: string,
  on: boolean,
): SkillSelection => {
  if (!on) return { ...selection, tools: selection.tools.filter((t) => t !== tool) };
  const withTool = { ...selection, tools: unique([...selection.tools, tool]) };
  const owner = toolOwner(tool);
  return owner === undefined ? withTool : addSources(withTool, withRequired(owner));
};

/** Ticked sources that have tools but none of them ticked: the skill reads nothing there. */
export const unreadSources = (selection: SkillSelection): readonly string[] =>
  selection.sources.filter((id) => {
    const tools = sourceTools(id);
    return tools.length > 0 && !tools.some((tool) => selection.tools.includes(tool));
  });

/** The sentence the form shows for `unreadSources`, or null when there are none. */
export const unreadSourcesNote = (unread: readonly string[]): string | null => {
  if (unread.length === 0) return null;
  const names = unread.map(skillSourceLabel).join(", ");
  return unread.length === 1
    ? `${names} is read only through its tools. Tick one, or the skill reads nothing from it.`
    : `${names} are read only through their tools. Tick one for each, or the skill reads nothing from them.`;
};
