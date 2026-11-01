/**
 * `bun run prompt:size [--ollama <model>] [--num-ctx <n>]`: how many tokens the
 * twin system prompt and the model-facing tool list take, per data mode and
 * per skill, against the context chat asks Ollama for (issue #149).
 *
 * Without `--ollama` it prints the conservative estimate the budget test uses.
 * With it, it also sends each request to the local Ollama with one output
 * token and prints Ollama's own `prompt_eval_count`: the exact count from the
 * model's tokenizer and chat template. Synthetic and made-up data only.
 *
 * It prints every case the budget test checks (`promptSizeCases`) and exits 1
 * when a case cannot be built, is over its budget or leaves too little room
 * before twin notes (#401).
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
  TURN_RESERVE_TOKENS,
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
  {
    label: "personal, no wearable, VCF imported",
    mode: "personal",
    wearables: NO_WEARABLES,
    large: false,
    vcfImported: true,
  },
  { label: "personal, Oura", mode: "personal", wearables: ONE_WEARABLE, large: false },
  {
    label: "personal, Oura, GBD and VCF imported",
    mode: "personal",
    wearables: ONE_WEARABLE,
    large: false,
    gbdImported: true,
    vcfImported: true,
  },
  {
    label: "personal, all 4 wearables, VCF imported",
    mode: "personal",
    wearables: WORST_CASE_WEARABLES,
    large: true,
    vcfImported: true,
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
      vcfImported: "vcfImported" in context && context.vcfImported,
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

/**
 * Tokens every case must leave free under its budget before twin notes
 * (#393), so the next tool or prompt line does not have to cut another. Twin
 * notes are left out of this check: they are cut to whatever room the turn
 * leaves (`twin-notes-room.ts`), so they shrink rather than break the budget.
 */
export const PROMPT_HEADROOM_TOKENS = 500;

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

/** The context large cases are measured at, as the docs ask for all four wearables. */
export const LARGE_NUM_CTX = 32_768;

/**
 * The context a case is measured at: the one given with `--num-ctx` or
 * `OLLAMA_NUM_CTX`, else the default, or {@link LARGE_NUM_CTX} for a large
 * case. The budget test uses the same rule, so both judge a case alike.
 */
export const numCtxFor = (sizeCase: SizeCase, given: number | null): number =>
  given ?? (sizeCase.largeContext ? LARGE_NUM_CTX : DEFAULT_OLLAMA_NUM_CTX);

/**
 * What is wrong with a case's size, empty when it fits: the prompt and tools
 * (Ollama's exact count when there is one, else the estimate) over the budget,
 * or less than {@link PROMPT_HEADROOM_TOKENS} left before twin notes.
 */
export const sizeProblems = (
  size: Readonly<{ tokens: number; beforeNotes: number; budget: number }>,
): readonly string[] => [
  ...(size.tokens > size.budget
    ? [`${size.tokens - size.budget} tokens over the budget of ${size.budget}`]
    : []),
  ...(size.budget - size.beforeNotes < PROMPT_HEADROOM_TOKENS
    ? [
        `${size.budget - size.beforeNotes} tokens free before twin notes, ${PROMPT_HEADROOM_TOKENS} needed`,
      ]
    : []),
];

const argValue = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  // Until every case is printed, a stop of any kind (a promise that never
  // settles lets Bun leave the loop early) is a failure, not a quiet 0 (#401).
  process.exitCode = 1;
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const givenText = argValue("--num-ctx") ?? process.env.OLLAMA_NUM_CTX;
  const given = givenText === undefined ? null : Number(givenText);
  if (given !== null && !(Number.isInteger(given) && given > 0)) {
    console.error(`--num-ctx must be a whole number of tokens, got "${givenText}".`);
    process.exit(2);
  }
  const model = argValue("--ollama");
  const apiRoot = ollamaApiRoot(process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL);
  const cases = promptSizeCases(loadSkills(root));
  console.log(
    `Budget: num_ctx less ${TURN_RESERVE_TOKENS} tokens for the turn; ${given === null ? `num_ctx ${DEFAULT_OLLAMA_NUM_CTX}, ${LARGE_NUM_CTX} for cases that need more` : `num_ctx ${given} for every case`}. Each case must also leave ${PROMPT_HEADROOM_TOKENS} tokens free before twin notes. Estimate: 1 per digit, prose chars / 2.5, tool JSON chars / 4, plus the template. "fits" uses the exact count when there is one.`,
  );
  console.log(
    [
      "case",
      "num_ctx",
      "tools",
      "system chars",
      "tool chars",
      "estimate",
      ...(model ? [`${model} exact`] : []),
      "free before notes",
      "fits",
    ].join(" | "),
  );
  const failed: string[] = [];
  for (const sizeCase of cases) {
    const numCtx = numCtxFor(sizeCase, given);
    const budget = promptBudgetTokens(numCtx);
    try {
      const body = await captureOllamaTurnRequest(sizeCase.turn, numCtx);
      const bare = await captureOllamaTurnRequest(
        { ...sizeCase.turn, twinNotes: [] },
        numCtx,
      );
      const row = sizeRow(sizeCase.label, body);
      const beforeNotes = estimatePromptTokens(bare);
      const exact = model ? await ollamaCount(apiRoot, model, body) : null;
      const problems = sizeProblems({
        tokens: exact ?? row.estimate,
        beforeNotes,
        budget,
      });
      if (problems.length > 0) failed.push(sizeCase.label);
      console.log(
        [
          row.label,
          numCtx,
          row.tools,
          row.systemChars,
          row.toolChars,
          row.estimate,
          ...(model ? [exact ?? "?"] : []),
          budget - beforeNotes,
          problems.length === 0 ? "yes" : `NO: ${problems.join("; ")}`,
        ].join(" | "),
      );
    } catch (error) {
      failed.push(sizeCase.label);
      console.log(
        `${sizeCase.label} | ${numCtx} | could not build the request: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  console.log(
    failed.length === 0
      ? `${cases.length} cases, all fit.`
      : `${cases.length} cases, ${failed.length} failed: ${failed.join(", ")}.`,
  );
  process.exitCode = failed.length === 0 ? 0 : 1;
}
