import { jsonSchema, type JSONSchema7, type Schema } from "ai";
import { z } from "zod";

/**
 * The tool input schemas as models receive them, and the one place that
 * builds that form: chat and the eval harness (`createQueryTools`), the
 * OpenAI tool list and the training data all use it.
 *
 * zod's JSON Schema for a window bound is three long date regexes with
 * formats, repeated for every bound; that was about three quarters of the
 * tokens in the tool definitions. Models get the slim form below. The zod
 * schemas still parse every call before a tool runs, so nothing the patterns
 * used to say is accepted now.
 */

/** Keys left out of the model's copy; zod still enforces what they said. */
const DROPPED_KEYS: ReadonlySet<string> = new Set(["$schema", "pattern", "format"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** One branch when every branch of an `anyOf` reads the same once slimmed. */
const collapseAnyOf = (node: Record<string, unknown>): Record<string, unknown> => {
  const { anyOf, ...rest } = node;
  if (!Array.isArray(anyOf)) return node;
  const distinct = [
    ...new Map(anyOf.map((branch) => [JSON.stringify(branch), branch])).values(),
  ];
  if (distinct.length !== 1 || !isRecord(distinct[0]))
    return { ...rest, anyOf: distinct };
  return { ...distinct[0], ...rest };
};

/** Objects are closed unless they say otherwise, as the AI SDK sends them. */
const closeObject = (node: Record<string, unknown>): Record<string, unknown> =>
  node.type === "object" && node.additionalProperties === undefined
    ? { ...node, additionalProperties: false }
    : node;

const slim = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(slim);
  if (!isRecord(node)) return node;
  const kept = Object.entries(node)
    .filter(([key]) => !DROPPED_KEYS.has(key))
    .map(([key, value]) => [key, slim(value)] as const);
  return closeObject(collapseAnyOf(Object.fromEntries(kept)));
};

/**
 * The JSON Schema a model gets for a tool's input: draft-07, the input side
 * and closed objects, as the AI SDK emits it, without `$schema`, regex `pattern`s or
 * `format`s, so a window bound is a plain string with its description. The
 * root description is dropped too; the tool's own description says it.
 * Every property, type, enum, bound and required list stays.
 */
export const modelJsonSchema = (schema: z.ZodType): JSONSchema7 => {
  const slimmed = slim(z.toJSONSchema(schema, { target: "draft-7", io: "input" }));
  const { description: _rootDescription, ...root } = isRecord(slimmed) ? slimmed : {};
  // zod's draft-07 output with keys removed is still a draft-07 schema.
  return root as JSONSchema7;
};

/**
 * A tool `inputSchema` that shows the model `modelJsonSchema(schema)` and
 * parses every call with the zod schema itself, as `tool({ inputSchema: zod })`
 * would. A call zod rejects never reaches `execute`.
 */
export const modelInputSchema = <T extends z.ZodType>(schema: T): Schema<z.output<T>> =>
  jsonSchema<z.output<T>>(() => modelJsonSchema(schema), {
    validate: async (value) => {
      const result = await schema.safeParseAsync(value);
      return result.success
        ? { success: true, value: result.data }
        : { success: false, error: result.error };
    },
  });
