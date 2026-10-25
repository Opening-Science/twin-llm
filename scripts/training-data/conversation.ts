/**
 * One training conversation in the OpenAI chat format with tool calls, plus a
 * `meta` record trainers can drop. Pure.
 *
 * Each tool call is its own assistant turn followed by the tool's result, in
 * the order the generator made them, because a later call can depend on an
 * earlier result (a window from `subject_window`). The final turn uses the
 * four headings of the Twin system prompt, or a `REFUSE:` line.
 */
import { z } from "zod";

import { sha256Hex, toCanonicalJson } from "../../packages/audit/hash";
import { GBD_MODEL_TOOL } from "../../packages/gbd-mcp/constants";
import { GUIDELINE_MODEL_TOOL } from "../../packages/guidelines/constants";
import { KNOWLEDGE_MODEL_TOOL } from "../../packages/knowledge/constants";
import { isToolRefusal } from "../../packages/query-tools/refusals";
import { TOOL_DEFINITIONS } from "../../packages/query-tools/schemas";
import { type KeyedTool, KEYED_TOOLS } from "../evaluation/question-set";
import { rowCountOf } from "../evaluation/build-answer-key";

import type { Draft, Outcome, Sections, ToolCall } from "./families";

export const GENERATOR_VERSION = "1";

export type SystemPrompt = Readonly<{ id: string; text: string }>;

/** Tool names the training records never offer; their prompt lines are dropped. */
const NON_QUERY_TOOLS = [
  GBD_MODEL_TOOL,
  GUIDELINE_MODEL_TOOL,
  KNOWLEDGE_MODEL_TOOL,
] as const;

/**
 * The Twin prompt for the nine query tools only: lines naming the GBD,
 * guideline or knowledge tools are removed, and the id says so.
 */
export const queryToolsOnlyPrompt = (prompt: SystemPrompt): SystemPrompt => ({
  id: `${prompt.id}/query-tools-only`,
  text: prompt.text
    .split("\n")
    .filter((line) => !NON_QUERY_TOOLS.some((name) => line.includes(name)))
    .join("\n"),
});

type ToolCallMessage = Readonly<{
  id: string;
  type: "function";
  function: Readonly<{ name: string; arguments: string }>;
}>;

export type Message =
  | Readonly<{ role: "system" | "user"; content: string }>
  | Readonly<{ role: "assistant"; content: null; tool_calls: readonly ToolCallMessage[] }>
  | Readonly<{ role: "assistant"; content: string }>
  | Readonly<{ role: "tool"; tool_call_id: string; content: string }>;

export type AnswerClass = "analytics" | "information" | "declined_decision_support";

export type ConversationMeta = Readonly<{
  family: Draft["family"];
  outcome: Outcome;
  subject_ref: string | null;
  cohort_id: string;
  seed: number;
  generator_version: string;
  tool_calls: readonly string[];
  tool_args_sha256: string;
  system_prompt_id: string;
  system_prompt_sha256: string;
  expected_answer_class: AnswerClass;
  synthetic: true;
}>;

export type ConversationRecord = Readonly<{
  messages: readonly Message[];
  tools: ReturnType<typeof toolSchemas>;
  meta: ConversationMeta;
}>;

/** JSON Schema minus the noise: no `$schema`, no regex beside a date-time format. */
const tidySchema = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(tidySchema);
  if (typeof node !== "object" || node === null) return node;
  const entries = Object.entries(node).filter(
    ([key]) =>
      key !== "$schema" &&
      !(key === "pattern" && Reflect.get(node, "format") === "date-time"),
  );
  return Object.fromEntries(entries.map(([key, value]) => [key, tidySchema(value)]));
};

/** The closed query tools as OpenAI function definitions, from the same Zod schemas. */
export const toolSchemas = () =>
  TOOL_DEFINITIONS.map((definition) => ({
    type: "function" as const,
    function: {
      name: definition.name,
      description: definition.description,
      parameters: tidySchema(z.toJSONSchema(definition.input)),
    },
  }));

export const renderSections = (sections: Sections): string =>
  [
    "## Reasoning",
    sections.reasoning,
    "",
    "## Evidence Used",
    "- none",
    "",
    "## Answer",
    sections.answer,
    "",
    "## Uncertainty",
    sections.uncertainty,
  ].join("\n");

const isKeyed = (name: string): name is KeyedTool => name in KEYED_TOOLS;

/** Rows a call read, as its audit row counts them; a refusal reads none. */
export const callRows = (call: ToolCall): number => {
  if (isToolRefusal(call.result)) return 0;
  if (call.name === "subject_window") {
    const n = Reflect.get(Object(call.result), "n_observations");
    return typeof n === "number" ? n : 0;
  }
  return isKeyed(call.name) ? rowCountOf(call.name, call.result) : 0;
};

/** The host's answer class for this reply (docs/response-schema.md). */
export const expectedAnswerClass = (draft: Draft): AnswerClass => {
  if (draft.reply.kind === "refuse") return "declined_decision_support";
  return draft.calls.some((call) => callRows(call) > 0) ? "analytics" : "information";
};

export const toConversation = (
  draft: Draft,
  context: Readonly<{ cohortId: string; seed: number; prompt: SystemPrompt }>,
): ConversationRecord => {
  const toolTurns = draft.calls.flatMap((call, index): Message[] => {
    const id = `call_${index + 1}`;
    return [
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id,
            type: "function",
            function: { name: call.name, arguments: JSON.stringify(call.args) },
          },
        ],
      },
      { role: "tool", tool_call_id: id, content: JSON.stringify(call.result) },
    ];
  });
  const final =
    draft.reply.kind === "refuse"
      ? draft.reply.text
      : renderSections(draft.reply.sections);
  return {
    messages: [
      { role: "system", content: context.prompt.text },
      { role: "user", content: draft.question },
      ...toolTurns,
      { role: "assistant", content: final },
    ],
    tools: toolSchemas(),
    meta: {
      family: draft.family,
      outcome: draft.outcome,
      subject_ref: draft.subjectRef,
      cohort_id: context.cohortId,
      seed: context.seed,
      generator_version: GENERATOR_VERSION,
      tool_calls: draft.calls.map((call) => call.name),
      tool_args_sha256: sha256Hex(
        toCanonicalJson(
          draft.calls.map((call) => ({ name: call.name, args: call.args })),
        ),
      ),
      system_prompt_id: context.prompt.id,
      system_prompt_sha256: sha256Hex(context.prompt.text),
      expected_answer_class: expectedAnswerClass(draft),
      synthetic: true,
    },
  };
};
