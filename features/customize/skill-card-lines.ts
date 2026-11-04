import type { TurnSkill } from "@/infrastructure/skill-gate";

/** The words on a skill's card (#457): pure, so the lines are tested. */

export const toolsText = (count: number): string =>
  count === 0 ? "no tools" : count === 1 ? "1 tool" : `${count} tools`;

export const providerLine = (providers: readonly string[]): string =>
  providers.length === 1 && providers[0] === "ollama"
    ? "runs on local models only"
    : `runs on: ${providers.join(", ")}`;

/** "2 tools · runs on local models only". */
export const skillCardMeta = (skill: Pick<TurnSkill, "tools" | "providers">): string =>
  `${toolsText(skill.tools.length)} · ${providerLine(skill.providers)}`;

/** A skill the person wrote has no eval cases; the palette says the same. */
export const OWN_SKILL_META = "Yours · not evaluated";

/** A shipped skill's page is at its name; the person's own at its id. */
export const skillHref = (nameOrId: string): string => `/customize/skills/${nameOrId}`;
