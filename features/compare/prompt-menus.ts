import { LIVE_SOURCES } from "@/infrastructure/live-sources";

import type { PromptSourceFacts } from "./conversation";

/**
 * The prompt box's two menus (SPEC 3.3): `/word` opens the command palette,
 * only when the whole box is `/word`; `@word` at the end opens the sources
 * list. A mention is plain text: picking one changes no permission.
 */

/** The query of a `/word` box, or null when the box is anything else. */
export const slashQuery = (draft: string): string | null => {
  const match = /^\/([a-z0-9-]*)$/i.exec(draft);
  return match === null ? null : (match[1] ?? "");
};

/** The query of an `@word` at the end of the box, or null. */
export const mentionQuery = (draft: string): string | null => {
  const match = /(?:^|\s)@([\w-]*)$/.exec(draft);
  return match === null ? null : (match[1] ?? "");
};

export type SourceOption = Readonly<{
  id: string;
  name: string;
  /** `import` opens Customize · Data instead of writing a mention. */
  kind: "source" | "import";
}>;

export const IMPORT_FILE: SourceOption = {
  id: "import",
  name: "Import a file",
  kind: "import",
};

export type LinkedWearables = Readonly<{
  oura: boolean;
  whoop: boolean;
  googleHealth: boolean;
}>;

/** Every source the list may offer, in its order, then "Import a file". */
export const sourceOptions = (
  facts: PromptSourceFacts,
  linked: LinkedWearables,
): readonly SourceOption[] => [
  ...(linked.oura ? [{ id: "oura", name: "Oura", kind: "source" as const }] : []),
  ...(linked.whoop ? [{ id: "whoop", name: "Whoop", kind: "source" as const }] : []),
  ...(linked.googleHealth
    ? [{ id: "google-health", name: "Google Health", kind: "source" as const }]
    : []),
  ...(facts.imported
    ? [{ id: "imported", name: "Imported data", kind: "source" as const }]
    : []),
  ...(facts.genome ? [{ id: "genome", name: "Genome", kind: "source" as const }] : []),
  ...LIVE_SOURCES.filter((source) => facts.live.includes(source.id)).map((source) => ({
    id: source.id,
    name: source.label,
    kind: "source" as const,
  })),
  IMPORT_FILE,
];

const squash = (name: string): string => name.replace(/\s+/g, "");

/** The options whose name (spaces removed) starts with the query. */
export const matchSources = (
  query: string,
  options: readonly SourceOption[],
): readonly SourceOption[] => {
  const prefix = query.toLowerCase();
  return options.filter((option) => squash(option.name).toLowerCase().startsWith(prefix));
};

/** The box with its trailing `@word` replaced by `@Name `. */
export const withMention = (draft: string, option: SourceOption): string =>
  draft.replace(/@([\w-]*)$/, `@${squash(option.name)} `);

/** The box after picking a skill from the palette. */
export const withCommand = (name: string): string => `/${name} `;

export type MenuAction =
  Readonly<{ kind: "move"; index: number }> | "pick" | "close" | null;

/** Keys in the sources list: arrows move, Enter and Tab pick, Escape closes. */
export const sourceKey = (key: string, active: number, count: number): MenuAction => {
  if (key === "Escape") return "close";
  if (count === 0) return null;
  if (key === "Enter" || key === "Tab") return "pick";
  if (key === "ArrowDown") return { kind: "move", index: (active + 1) % count };
  if (key === "ArrowUp") return { kind: "move", index: (active + count - 1) % count };
  return null;
};

export const sourceOptionId = (id: string): string => `source-option-${id}`;
