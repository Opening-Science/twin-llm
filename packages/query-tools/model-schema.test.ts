import { describe, expect, test } from "bun:test";

import { generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";

import type { AppendInput } from "@/packages/audit/append";

import { createQueryTools } from "./ai-tools";
import { modelJsonSchema } from "./model-schema";
import type { ObservationQuery, QueryToolPorts } from "./ports";
import { summaryStatsInput } from "./schemas";

const SUBJECT = "9661a432-4630-2cd9-142c-386845fae837";
const START_TEXT = "ISO-8601 UTC datetime, or YYYY-MM-DD for the start of that day";
const END_TEXT = "ISO-8601 UTC datetime, or YYYY-MM-DD for the end of that day";

describe("modelJsonSchema", () => {
  test("summary_stats before: each window bound is three regex branches", () => {
    const full = z.toJSONSchema(summaryStatsInput, { target: "draft-7", io: "input" });
    const start = Object(Reflect.get(Object(full.properties), "start"));
    expect(full.$schema).toBe("http://json-schema.org/draft-07/schema#");
    expect(
      start.anyOf.map((branch: Record<string, unknown>) => [
        branch.type,
        branch.format ?? null,
        typeof branch.pattern,
      ]),
    ).toEqual([
      ["string", "date-time", "string"],
      ["string", null, "string"],
      ["string", "date", "string"],
    ]);
    expect(Reflect.get(Object(full.properties), "loinc")).toEqual({
      type: "string",
      pattern: "^\\d{1,5}-\\d+$",
      description: "LOINC code",
    });
  });

  test("summary_stats after: the exact schema a model gets", () => {
    expect(modelJsonSchema(summaryStatsInput)).toEqual({
      type: "object",
      properties: {
        subject_ref: {
          type: "string",
          minLength: 1,
          maxLength: 128,
          description: "Opaque subject_ref",
        },
        loinc: { type: "string", description: "LOINC code" },
        start: { type: "string", description: START_TEXT },
        end: { type: "string", description: END_TEXT },
      },
      required: ["subject_ref", "loinc", "start", "end"],
      additionalProperties: false,
    });
  });

  test("keeps array and number bounds", () => {
    const schema = z
      .object({
        codes: z.array(z.string().regex(/^\d+$/)).min(1).max(20),
        limit: z.number().int().min(1).max(500),
        kind: z.enum(["a", "b"]),
      })
      .describe("dropped at the root");
    expect(modelJsonSchema(schema)).toEqual({
      type: "object",
      properties: {
        codes: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 20 },
        limit: { type: "integer", minimum: 1, maximum: 500 },
        kind: { type: "string", enum: ["a", "b"] },
      },
      required: ["codes", "limit", "kind"],
      additionalProperties: false,
    });
  });

  test("an anyOf of different types stays an anyOf", () => {
    expect(
      modelJsonSchema(z.object({ v: z.union([z.string().max(3), z.number().min(0)]) })),
    ).toEqual({
      type: "object",
      properties: {
        v: {
          anyOf: [
            { type: "string", maxLength: 3 },
            { type: "number", minimum: 0 },
          ],
        },
      },
      required: ["v"],
      additionalProperties: false,
    });
  });
});

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

/** One model step that calls `trend` with `start`, through the AI SDK's own parsing. */
const trendCall = async (start: string) => {
  const queries: ObservationQuery[] = [];
  const audits: AppendInput[] = [];
  const ports: QueryToolPorts = {
    findSubject: async () => ({ isSynthetic: true, cohortId: "synthea-v4-seed42" }),
    findObservations: async (query) => {
      queries.push(query);
      return [];
    },
    appendAudit: async (input) => {
      audits.push(input);
    },
  };
  const model = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [
        {
          type: "tool-call",
          toolCallId: "call-1",
          toolName: "trend",
          input: JSON.stringify({
            subject_ref: SUBJECT,
            loinc: "4548-4",
            start,
            end: "2025-12-31",
          }),
        },
      ],
      finishReason: { unified: "tool-calls", raw: "tool_calls" },
      usage,
      warnings: [],
    }),
  });
  const result = await generateText({
    model,
    tools: createQueryTools(
      { actor: "test", sessionId: "turn-slim", mode: "synthetic" },
      ports,
    ),
    prompt: "HbA1c trend",
  });
  const sent = model.doGenerateCalls[0]?.tools?.find((tool) => tool.name === "trend");
  return { result, queries, audits, sent };
};

describe("validation is unchanged at runtime", () => {
  test("the model sees a plain string for a window bound", async () => {
    const { sent } = await trendCall("2024-01-01");
    expect(
      sent && "inputSchema" in sent ? sent.inputSchema.properties?.start : null,
    ).toEqual({ type: "string", description: START_TEXT });
  });

  test("a date the slim schema allows but zod rejects never reaches the tool", async () => {
    const { result, queries, audits } = await trendCall("2024-02-30");
    expect(result.toolResults).toEqual([]);
    expect(
      result.content.map((part) =>
        part.type === "tool-error" ? [part.type, part.toolName, part.input] : [part.type],
      ),
    ).toEqual([
      ["tool-call"],
      [
        "tool-error",
        "trend",
        { subject_ref: SUBJECT, loinc: "4548-4", start: "2024-02-30", end: "2025-12-31" },
      ],
    ]);
    expect(queries).toEqual([]);
    expect(audits).toEqual([]);
  });

  test("free text in a window bound is refused the same way", async () => {
    const { result, queries } = await trendCall("last spring");
    expect(result.content.map((part) => part.type)).toEqual(["tool-call", "tool-error"]);
    expect(queries).toEqual([]);
  });

  test("a valid date still runs the tool", async () => {
    const { result, queries } = await trendCall("2024-01-01");
    expect(result.content.map((part) => part.type)).toEqual(["tool-call", "tool-result"]);
    expect(queries).toEqual([
      {
        subjectRef: SUBJECT,
        loinc: ["4548-4"],
        start: new Date("2024-01-01T00:00:00.000Z"),
        end: new Date("2025-12-31T23:59:59.999Z"),
        take: 5001,
      },
    ]);
  });
});
