import type { AppendInput } from "@/packages/audit/append";
import { VIEW_KINDS } from "@/packages/query-tools/view-schema";

import { VIEW_TOOLS } from "./chat-view";
import type { LlmProvider } from "./data-mode-policy";
import { ALL_KNOWLEDGE_SOURCES } from "./knowledge-sources";

/**
 * What a running skill may do, and the checks that hold it to that.
 *
 * `features/skills` turns a SKILL.md into a checked skill; `features/chat`
 * runs a turn under it; the palette shows what it may read. All three need
 * the same shape and the same rules, so they live here. Pure: the eval gate,
 * the chat route and the browser share it.
 *
 * A skill only narrows. Its tools are intersected with what the turn already
 * has after the user's source choices and the data-mode policy, its providers
 * are checked before the data-mode policy (which still runs), and its views
 * limit which kinds `show_view` will draw and `open_view` will reopen.
 */

/** Wearable context the person attached to the turn. Makes a request personal. */
export const WEARABLE_CONTEXT_SOURCE = "wearable-context" as const;

/** A checked skill, as the chat runs it. `features/skills` builds these. */
export type TurnSkill = Readonly<{
  name: string;
  description: string;
  tools: readonly string[];
  sources: readonly string[];
  providers: readonly LlmProvider[];
  views: readonly string[];
  /** The SKILL.md body. */
  instructions: string;
}>;

/** Same rule as the frontmatter `name`. */
export const SKILL_NAME_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;

/** Refusals that stop a whole request before the model is called. */
export const SKILL_REQUEST_REFUSALS = [
  "provider-not-allowed-by-skill",
  "source-not-allowed",
] as const;

export type SkillRequestRefusal = (typeof SKILL_REQUEST_REFUSALS)[number];

export type SkillRequestDecision =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; code: SkillRequestRefusal; error: string }>;

const PROVIDER_LABELS: Readonly<Record<LlmProvider, string>> = {
  ollama: "local Ollama",
  exoscale: "Exoscale",
  openrouter: "OpenRouter",
  "remote-gpu": "the remote GPU",
  infomaniak: "Infomaniak",
};

const orList = (items: readonly string[]): string =>
  items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} or ${items.at(-1) ?? ""}`;

/** The chat route's answer to a skill name it does not offer. */
export const SKILL_NOT_OFFERED = "skill-not-offered" as const;

export const skillNotOffered = (
  name: string,
): Readonly<{ code: typeof SKILL_NOT_OFFERED; error: string }> => ({
  code: SKILL_NOT_OFFERED,
  error: `There is no /${name} skill on this server, so nothing ran. Type / to see the skills it offers.`,
});

/**
 * The refusal when an agent's own skill (#218) cannot run for this turn. It
 * names the agent, since the person picked the agent and typed no `/skill`.
 * `providers` is null when the server does not offer the skill at all.
 */
export const agentSkillUnavailable = <Code extends string>(
  agentName: string,
  skill: Readonly<{ name: string; providers: readonly LlmProvider[] | null }>,
  code: Code,
): Readonly<{ code: Code; error: string }> => ({
  code,
  error:
    skill.providers === null
      ? `${agentName} isn't available here: its /${skill.name} skill is not offered on this server.`
      : `${agentName} isn't available here: its /${skill.name} skill runs only on ${orList(skill.providers.map((provider) => PROVIDER_LABELS[provider]))}.`,
});

/**
 * Codes whose `error` sentence the browser may show as it is. They are all
 * written here, so no provider or exception text can come through.
 */
export const isSkillRefusalCode = (value: unknown): boolean =>
  value === SKILL_NOT_OFFERED ||
  (typeof value === "string" &&
    (SKILL_REQUEST_REFUSALS as readonly string[]).includes(value));

/**
 * May this skill run for this request at all? The provider must be one the
 * skill lists, and a turn carrying wearable context needs a skill that reads it.
 */
export const permitSkillRequest = (
  skill: Pick<TurnSkill, "name" | "providers" | "sources">,
  request: Readonly<{ provider: LlmProvider; hasWearableContext: boolean }>,
): SkillRequestDecision => {
  if (!skill.providers.includes(request.provider)) {
    return {
      ok: false,
      code: "provider-not-allowed-by-skill",
      error: `/${skill.name} runs only on ${orList(skill.providers.map((provider) => PROVIDER_LABELS[provider]))}. The models here come from ${PROVIDER_LABELS[request.provider]}, so /${skill.name} did not run. Ask without /${skill.name} instead.`,
    };
  }
  if (request.hasWearableContext && !skill.sources.includes(WEARABLE_CONTEXT_SOURCE)) {
    return {
      ok: false,
      code: "source-not-allowed",
      error: `/${skill.name} does not read linked wearables, and this question would carry them, so /${skill.name} did not run.`,
    };
  }
  return { ok: true };
};

/** True when `show_view` can draw at least one kind the skill allows. */
const allowsViews = (skill: Pick<TurnSkill, "views">): boolean =>
  VIEW_KINDS.some((kind) => skill.views.includes(kind));

/**
 * The tools a skill turn keeps: those it lists, plus the view tools
 * (`show_view`, `list_views`, `open_view`) when it allows a kind `show_view`
 * draws. Only ever removes; never adds a tool the turn did not already have.
 */
export const withSkillTools = <V>(
  tools: Readonly<Record<string, V>>,
  skill: Pick<TurnSkill, "tools" | "views">,
): Record<string, V> =>
  Object.fromEntries(
    Object.entries(tools).filter(([name]) =>
      VIEW_TOOLS.has(name) ? allowsViews(skill) : skill.tools.includes(name),
    ),
  );

/** Audit tool name of a skill run: `skill.sleep`. Hash-only rows keep the name readable. */
const SKILL_AUDIT_PREFIX = "skill.";

export const skillAuditTool = (name: string): string => `${SKILL_AUDIT_PREFIX}${name}`;

/** The skill a `skill.<name>` audit row names, or null for any other row. */
export const skillOfAuditTool = (tool: string): string | null => {
  if (!tool.startsWith(SKILL_AUDIT_PREFIX)) return null;
  const name = tool.slice(SKILL_AUDIT_PREFIX.length);
  return SKILL_NAME_PATTERN.test(name) ? name : null;
};

/**
 * The audit event written before a skill turn calls its model: which skill,
 * which model and provider, and what it was allowed. No prompt text.
 */
export const skillRunEvent = (
  skill: TurnSkill,
  call: Readonly<{
    actor: string;
    sessionId: string;
    modelId: string;
    provider: LlmProvider;
    /** Set when the skill came from an agent (#218), not from the prompt. */
    agent?: string;
    /** Set when Auto picked that agent (#219). */
    via?: "auto";
  }>,
): AppendInput => ({
  actor: call.actor,
  sessionId: call.sessionId,
  subjectRef: null,
  tool: skillAuditTool(skill.name),
  args: {
    skill: skill.name,
    modelId: call.modelId,
    provider: call.provider,
    tools: skill.tools,
    views: skill.views,
    ...(call.agent === undefined ? {} : { agent: call.agent }),
    ...(call.via === undefined ? {} : { via: call.via }),
  },
  result: { started: true },
  rowCount: 0,
});

const SOURCE_LABELS: ReadonlyMap<string, string> = new Map([
  ...ALL_KNOWLEDGE_SOURCES.map((source) => [source.id, source.label] as const),
  [WEARABLE_CONTEXT_SOURCE, "Your linked wearables"] as const,
]);

/** A source id as the palette names it. */
export const skillSourceLabel = (id: string): string => SOURCE_LABELS.get(id) ?? id;
