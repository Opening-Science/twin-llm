import { z } from "zod";

/**
 * Reading the files `bun run training:conversations` writes, for the Data
 * page's Training tab (docs/training-data.md). Pure: `training-files.ts`
 * reads the bytes, these functions parse them.
 *
 * A set is `<name>.jsonl` (messages), with `<name>.meta.jsonl` (one meta
 * record per line, same order) and `<name>.manifest.json` beside it. The
 * files are local output, so parsing is forgiving: a line that does not
 * parse is counted and skipped, never shown raw.
 */

/** File-name safe: no path separators, no leading dot. */
const SET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export const isSetName = (name: string): boolean =>
  SET_NAME.test(name) && !name.includes("..");

/** Set names from a directory listing: every `x.jsonl` that is not `x.meta.jsonl`. */
export const setNamesFrom = (fileNames: readonly string[]): readonly string[] =>
  fileNames
    .filter((name) => name.endsWith(".jsonl") && !name.endsWith(".meta.jsonl"))
    .map((name) => name.slice(0, -".jsonl".length))
    .filter(isSetName)
    .sort();

const countsSchema = z.record(z.string(), z.number().int().nonnegative());

const manifestSchema = z.object({
  cohort_id: z.string(),
  seed: z.number().int(),
  anchor_day: z.string().optional(),
  generator_version: z.string().optional(),
  system_prompt_id: z.string().optional(),
  subjects: z.number().int().nonnegative(),
  conversations: z.number().int().nonnegative(),
  byFamily: countsSchema,
  byOutcome: countsSchema,
});

export type TrainingManifest = Readonly<z.infer<typeof manifestSchema>>;

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

export const parseManifest = (text: string | null): TrainingManifest | null => {
  if (text === null) return null;
  const parsed = manifestSchema.safeParse(parseJson(text));
  return parsed.success ? parsed.data : null;
};

const metaSchema = z.object({
  family: z.string(),
  outcome: z.string(),
  subject_ref: z.string().nullable(),
  cohort_id: z.string(),
  tool_calls: z.array(z.string()),
  expected_answer_class: z.string(),
});

export type ConversationMeta = Readonly<z.infer<typeof metaSchema>> &
  Readonly<{ index: number }>;

export type MetaIndex = Readonly<{
  rows: readonly ConversationMeta[];
  skipped: number;
}>;

const lines = (text: string): readonly string[] =>
  text.split("\n").filter((line) => line.trim() !== "");

/** One row per meta line, numbered from 0 in file order (the record's line). */
export const parseMetaLines = (text: string): MetaIndex => {
  const parsed = lines(text).map((line, index) => {
    const result = metaSchema.safeParse(parseJson(line));
    return result.success ? { ...result.data, index } : null;
  });
  const rows = parsed.filter((row): row is ConversationMeta => row !== null);
  return { rows, skipped: parsed.length - rows.length };
};

export type Count = Readonly<{ key: string; count: number }>;

/** Counts per value, most first, then by name. */
export const countBy = <T>(
  rows: readonly T[],
  key: (row: T) => string,
): readonly Count[] =>
  [...Map.groupBy(rows, key).entries()]
    .map(([name, group]) => ({ key: name, count: group.length }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

export const CONVERSATIONS_PER_PAGE = 25;

export type MetaPage = Readonly<{
  rows: readonly ConversationMeta[];
  matching: number;
  page: number;
  pages: number;
}>;

export const pageMeta = (
  rows: readonly ConversationMeta[],
  family: string | null,
  page: number,
  perPage: number = CONVERSATIONS_PER_PAGE,
): MetaPage => {
  const matching = family ? rows.filter((row) => row.family === family) : rows;
  const pages = Math.max(1, Math.ceil(matching.length / perPage));
  const current = Math.min(Math.max(1, page), pages);
  return {
    rows: matching.slice((current - 1) * perPage, current * perPage),
    matching: matching.length,
    page: current,
    pages,
  };
};

const toolCallSchema = z.object({
  id: z.string(),
  function: z.object({ name: z.string(), arguments: z.string() }),
});

const messageSchema = z.union([
  z.object({ role: z.enum(["system", "user"]), content: z.string() }),
  z.object({
    role: z.literal("assistant"),
    content: z.null(),
    tool_calls: z.array(toolCallSchema),
  }),
  z.object({ role: z.literal("assistant"), content: z.string() }),
  z.object({ role: z.literal("tool"), tool_call_id: z.string(), content: z.string() }),
]);

const recordSchema = z.object({ messages: z.array(messageSchema) });

export type ToolStep = Readonly<{
  id: string;
  name: string;
  /** Pretty-printed JSON, or the raw text when it is not JSON. */
  args: string;
  result: string | null;
  /** A refusal code the tool returned (`SUBJECT_SCOPE_VIOLATION`, `MIXED_UNITS` …). */
  refusal: string | null;
}>;

export type ConversationView = Readonly<{
  system: string;
  user: string;
  steps: readonly ToolStep[];
  answer: string;
  refused: boolean;
}>;

const pretty = (text: string): string => {
  const value = parseJson(text);
  return value === undefined ? text : JSON.stringify(value, null, 2);
};

const refusalCode = (text: string): string | null => {
  const code = Reflect.get(Object(parseJson(text)), "code");
  return typeof code === "string" ? code : null;
};

/**
 * One JSONL record as the page shows it: the system prompt, the question,
 * each tool call paired with its result, and the final answer.
 */
export const parseConversation = (line: string): ConversationView | null => {
  const parsed = recordSchema.safeParse(parseJson(line));
  if (!parsed.success) return null;
  const messages = parsed.data.messages;
  const results = new Map(
    messages.flatMap((message) =>
      message.role === "tool" ? [[message.tool_call_id, message.content] as const] : [],
    ),
  );
  const steps = messages.flatMap((message) =>
    message.role === "assistant" && "tool_calls" in message
      ? message.tool_calls.map((call): ToolStep => {
          const result = results.get(call.id) ?? null;
          return {
            id: call.id,
            name: call.function.name,
            args: pretty(call.function.arguments),
            result: result === null ? null : pretty(result),
            refusal: result === null ? null : refusalCode(result),
          };
        })
      : [],
  );
  const textOf = (role: "system" | "user"): string => {
    const message = messages.find((candidate) => candidate.role === role);
    return message && typeof message.content === "string" ? message.content : "";
  };
  const answers = messages.flatMap((message) =>
    message.role === "assistant" && typeof message.content === "string"
      ? [message.content]
      : [],
  );
  const answer = answers[answers.length - 1] ?? "";
  return {
    system: textOf("system"),
    user: textOf("user"),
    steps,
    answer,
    refused: answer.startsWith("REFUSE:"),
  };
};
