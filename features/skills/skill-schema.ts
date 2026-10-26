import { z } from "zod";

import {
  LLM_PROVIDERS,
  type LlmProvider,
  permitProviderForRequest,
} from "@/infrastructure/data-mode-policy";
import {
  ALL_KNOWLEDGE_SOURCES,
  KNOWLEDGE_SOURCE_IDS,
} from "@/infrastructure/knowledge-sources";

/**
 * What a skill may touch, checked strictly. A skill is data: these lists are
 * allowlists, and the eval runner refuses anything outside them.
 */

/** Wearable context the person attached to the turn. Makes a request personal. */
export const WEARABLE_CONTEXT_SOURCE = "wearable-context" as const;

export const SKILL_SOURCE_IDS = [
  ...KNOWLEDGE_SOURCE_IDS,
  WEARABLE_CONTEXT_SOURCE,
] as const;

export type SkillSourceId = (typeof SKILL_SOURCE_IDS)[number];

/** View kinds from the chat platform plan (docs/chat-platform.md, section 1). */
export const SKILL_VIEW_KINDS = [
  "chart.timeseries",
  "chart.compare",
  "biomarker.card",
  "twin.body",
  "table",
] as const;

export type SkillViewKind = (typeof SKILL_VIEW_KINDS)[number];

/** Every chat tool, and the knowledge source that owns it. */
const TOOL_SOURCE: ReadonlyMap<string, SkillSourceId> = new Map(
  ALL_KNOWLEDGE_SOURCES.flatMap((source) =>
    source.tools.map((tool) => [tool, source.id] as const),
  ),
);

export const CHAT_TOOL_NAMES: readonly string[] = [...TOOL_SOURCE.keys()];

/** Providers start local only; a skill must name any other provider itself. */
export const DEFAULT_SKILL_PROVIDERS: readonly LlmProvider[] = ["ollama"];

const SKILL_NAME = /^[a-z][a-z0-9-]{0,39}$/;

const chatToolName = z.string().refine((name) => TOOL_SOURCE.has(name), {
  error: (issue) =>
    `unknown tool "${String(issue.input)}"; known tools: ${CHAT_TOOL_NAMES.join(", ")}`,
});

const uniqueList = <T extends z.ZodType>(item: T) =>
  z.array(item).refine((items) => new Set(items).size === items.length, {
    error: "list has a duplicate entry",
  });

/**
 * True when the data-mode policy could let this provider see personal data
 * under its most permissive setting. If not, a skill that reads personal data
 * may not list it: a skill can narrow the policy, never widen it.
 */
const policyCanTakePersonalData = (provider: LlmProvider): boolean =>
  permitProviderForRequest({
    mode: "personal",
    provider,
    hasWearableNarrative: true,
    exoscalePersonalData: "consented-pilot",
  }).ok;

export const skillFrontmatterSchema = z
  .strictObject({
    name: z.string().regex(SKILL_NAME, {
      error: "name must be lower-case letters, digits and dashes, at most 40 characters",
    }),
    description: z.string().min(1).max(200),
    tools: uniqueList(chatToolName),
    sources: uniqueList(z.enum(SKILL_SOURCE_IDS)).min(1),
    providers: uniqueList(z.enum(LLM_PROVIDERS))
      .min(1)
      .default([...DEFAULT_SKILL_PROVIDERS]),
    views: uniqueList(z.enum(SKILL_VIEW_KINDS)).default([]),
  })
  .superRefine((skill, ctx) => {
    const sources: ReadonlySet<string> = new Set(skill.sources);
    skill.tools.forEach((tool, index) => {
      const owner = TOOL_SOURCE.get(tool);
      if (owner !== undefined && !sources.has(owner)) {
        ctx.addIssue({
          code: "custom",
          path: ["tools", index],
          message: `tool "${tool}" needs source "${owner}" in sources`,
        });
      }
    });
    skill.sources.forEach((id, index) => {
      const required = ALL_KNOWLEDGE_SOURCES.find((source) => source.id === id)?.requires;
      if (required !== undefined && !sources.has(required)) {
        ctx.addIssue({
          code: "custom",
          path: ["sources", index],
          message: `source "${id}" needs source "${required}" in sources`,
        });
      }
    });
    if (sources.has(WEARABLE_CONTEXT_SOURCE)) {
      skill.providers.forEach((provider, index) => {
        if (!policyCanTakePersonalData(provider)) {
          ctx.addIssue({
            code: "custom",
            path: ["providers", index],
            message: `provider "${provider}" may never receive personal data (infrastructure/data-mode-policy.ts), so a skill reading ${WEARABLE_CONTEXT_SOURCE} cannot list it`,
          });
        }
      });
    }
  });

export type SkillFrontmatter = z.infer<typeof skillFrontmatterSchema>;

export type Skill = SkillFrontmatter &
  Readonly<{
    /** The SKILL.md body: instructions for the model. */
    instructions: string;
    evals: readonly SkillEvalCase[];
  }>;

/** What the gate refuses, as stable codes eval cases name. */
export const SKILL_REFUSALS = [
  "provider-not-allowed-by-skill",
  "provider-not-permitted-for-data-mode",
  "source-not-allowed",
  "tool-not-allowed",
  "invalid-tool-input",
  "view-not-allowed",
] as const;

export type SkillRefusal = (typeof SKILL_REFUSALS)[number];

const scriptedStepSchema = z.union([
  z.strictObject({
    tool: z.string().min(1),
    input: z.record(z.string(), z.unknown()),
  }),
  z.strictObject({ view: z.string().min(1) }),
]);

export type ScriptedStep = z.infer<typeof scriptedStepSchema>;

/**
 * One eval case. `script` is what the scripted model tries, in order; the gate
 * decides what runs. `expect` is the exact outcome.
 */
export const skillEvalCaseSchema = z.strictObject({
  question: z.string().min(1),
  provider: z.enum(LLM_PROVIDERS).default("ollama"),
  dataMode: z.enum(["synthetic", "personal"]).default("synthetic"),
  exoscalePersonalData: z.enum(["off", "consented-pilot"]).default("off"),
  wearableContext: z.boolean().default(false),
  script: z.array(scriptedStepSchema),
  expect: z.strictObject({
    calls: z.array(chatToolName),
    views: z.array(z.enum(SKILL_VIEW_KINDS)).default([]),
    refusals: uniqueList(z.enum(SKILL_REFUSALS)),
  }),
});

export type SkillEvalCase = z.infer<typeof skillEvalCaseSchema> &
  Readonly<{ id: string }>;
