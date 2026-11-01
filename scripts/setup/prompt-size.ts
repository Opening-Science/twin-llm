/**
 * `bun run prompt:size [--ollama <model>] [--num-ctx <n>]`: how many tokens the
 * twin system prompt and the model-facing tool list take, per data mode and
 * per skill, against the context chat asks Ollama for (issue #149).
 *
 * Without `--ollama` it prints the conservative estimate the budget test uses.
 * With it, it also sends each request to the local Ollama with one output
 * token and prints Ollama's own `prompt_eval_count`: the exact count from the
 * model's tokenizer and chat template. Synthetic and made-up data only.
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  captureOllamaTurnRequest,
  estimatePromptTokens,
  type OllamaChatBody,
  systemTextOf,
  toolTextOf,
  type TurnRequestCase,
} from "../../features/chat/ollama-turn-request";
import { checkSkills, readSyntheticSubjects } from "../../features/skills/read-skills";
import {
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_NUM_CTX,
  ollamaApiRoot,
  promptBudgetTokens,
} from "../../infrastructure/ollama-context";
import { AGENTS } from "../../infrastructure/agents";
import type { TurnSkill } from "../../infrastructure/skill-gate";
import {
  LONGEST_TWIN_NOTES,
  LONGEST_UI_CONTEXT,
  NO_WEARABLES,
  ONE_WEARABLE,
  WORST_CASE_WEARABLES,
} from "./prompt-size-fixtures";

/**
 * `largeContext`: needs more than the default context. A linked wearable lists
 * its metrics twice (narrative lines and the key list), about 4,500 tokens a
 * source, so all four together only fit with OLLAMA_NUM_CTX=32768.
 */
export type SizeCase = Readonly<{
  label: string;
  turn: TurnRequestCase;
  largeContext: boolean;
}>;

const QUESTION = "Show me a chart of heart rate for subject synthetic-subject.";

const CONTEXTS = [
  { label: "synthetic", mode: "synthetic", wearables: NO_WEARABLES, large: false },
  {
    label: "synthetic, GBD imported",
    mode: "synthetic",
    wearables: NO_WEARABLES,
    large: false,
    gbdImported: true,
  },
  {
    label: "personal, no wearable",
    mode: "personal",
    wearables: NO_WEARABLES,
    large: false,
  },
  { label: "personal, Oura", mode: "personal", wearables: ONE_WEARABLE, large: false },
  {
    label: "personal, Oura, GBD imported",
    mode: "personal",
    wearables: ONE_WEARABLE,
    large: false,
    gbdImported: true,
  },
  {
    label: "personal, all 4 wearables",
    mode: "personal",
    wearables: WORST_CASE_WEARABLES,
    large: true,
  },
] as const;

/**
 * Every data mode and wearable load, without a skill, under each skill, and
 * as each agent (#218) with its skill when the server offers it.
 */
export const promptSizeCases = (skills: readonly TurnSkill[]): readonly SizeCase[] =>
  CONTEXTS.flatMap((context) => {
    const turnFor = (
      skill: TurnSkill | null,
      agent: Readonly<{ name: string; role: string }> | null,
    ) => ({
      mode: context.mode,
      skill,
      wearables: context.wearables,
      question: QUESTION,
      uiContext: LONGEST_UI_CONTEXT,
      twinNotes: LONGEST_TWIN_NOTES,
      agent,
      gbdImported: "gbdImported" in context && context.gbdImported,
    });
    return [
      ...[null, ...skills].map((skill) => ({
        label: `${context.label}${skill === null ? "" : ` /${skill.name}`}`,
        turn: turnFor(skill, null),
        largeContext: context.large,
      })),
      ...AGENTS.map((agent) => ({
        label: `${context.label} agent:${agent.id}`,
        turn: turnFor(skills.find(({ name }) => name === agent.skill) ?? null, agent),
        largeContext: context.large,
      })),
    ];
  });

/** The runnable skills under `skills/`, as the chat offers them. */
export const loadSkills = (root: string): readonly TurnSkill[] =>
  checkSkills(
    join(root, "skills"),
    readSyntheticSubjects(join(root, "evaluation", "questions.v1.json")),
  ).valid;

export type SizeRow = Readonly<{
  label: string;
  tools: number;
  systemChars: number;
  toolChars: number;
  estimate: number;
}>;

export const sizeRow = (label: string, body: OllamaChatBody): SizeRow => ({
  label,
  tools: body.tools?.length ?? 0,
  systemChars: systemTextOf(body).length,
  toolChars: toolTextOf(body).length,
  estimate: estimatePromptTokens(body),
});

/** Ollama's own token count for the request, with one output token. */
const ollamaCount = async (
  apiRoot: string,
  model: string,
  body: OllamaChatBody,
): Promise<number | null> => {
  const response = await fetch(`${apiRoot}/chat`, {
    method: "POST",
    body: JSON.stringify({
      ...body,
      model,
      stream: false,
      options: { ...body.options, num_ctx: 32_768, num_predict: 1 },
    }),
  });
  if (!response.ok) return null;
  const reply: unknown = await response.json();
  const count = Reflect.get(Object(reply), "prompt_eval_count");
  return typeof count === "number" ? count : null;
};

const argValue = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const numCtx = Number(
    argValue("--num-ctx") ?? process.env.OLLAMA_NUM_CTX ?? DEFAULT_OLLAMA_NUM_CTX,
  );
  const model = argValue("--ollama");
  const apiRoot = ollamaApiRoot(process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL);
  const budget = promptBudgetTokens(numCtx);
  console.log(
    `num_ctx ${numCtx}; prompt + tools may use ${budget} tokens. Estimate: 1 per digit, prose chars / 2.5, tool JSON chars / 4, plus the template. "fits" uses the exact count when there is one.`,
  );
  console.log(
    [
      "case",
      "tools",
      "system chars",
      "tool chars",
      "estimate",
      ...(model ? [`${model} exact`] : []),
      "fits",
    ].join(" | "),
  );
  for (const sizeCase of promptSizeCases(loadSkills(root))) {
    const body = await captureOllamaTurnRequest(sizeCase.turn, numCtx);
    const row = sizeRow(sizeCase.label, body);
    const exact = model ? await ollamaCount(apiRoot, model, body) : null;
    console.log(
      [
        row.label,
        row.tools,
        row.systemChars,
        row.toolChars,
        row.estimate,
        ...(model ? [exact ?? "?"] : []),
        (exact ?? row.estimate) <= budget ? "yes" : "NO",
      ].join(" | "),
    );
  }
}
