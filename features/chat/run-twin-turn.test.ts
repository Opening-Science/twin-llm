import { describe, expect, test } from "bun:test";

import { MockLanguageModelV4 } from "ai/test";

import {
  drainKnowledgeTurn,
  type KnowledgeCitation,
  recordKnowledgeTurn,
} from "@/packages/knowledge/collector";
import type { QueryToolPorts } from "@/packages/query-tools/ports";

import { createChatTools } from "./chat-tools";
import type { ResponseToolCall } from "./response/document-v1";
import { runTwinTurn, type TwinTurnFinish } from "./run-twin-turn";
import { buildTwinSystemPrompt } from "./twin-system-prompt";

/**
 * The turn the chat route and the eval harness share: what the model
 * is sent, the step limit, first-token timing and the document's audit read.
 * Fake model and fake query ports only; synthetic refs.
 */

const SUBJECT = "synthetic-subject-a";
const NO_WEARABLES = { oura: null, whoop: null, googleHealth: null, vitronic: null };

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

const streamOf = (parts: readonly Record<string, unknown>[]) => ({
  stream: new ReadableStream({
    start: (controller) => {
      parts.forEach((part) => controller.enqueue(part as never));
      controller.close();
    },
  }),
});

const toolCall = (id: string) => [
  {
    type: "tool-call",
    toolCallId: id,
    toolName: "trend",
    input: JSON.stringify({
      subject_ref: SUBJECT,
      loinc: "4548-4",
      start: "2024-01-01T00:00:00Z",
      end: "2026-01-01T00:00:00Z",
    }),
  },
  { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage },
];

const text = (delta: string) => [
  { type: "text-start", id: "t" },
  { type: "text-delta", id: "t", delta },
  { type: "text-delta", id: "t", delta: " more" },
  { type: "text-end", id: "t" },
  { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
];

const ports: QueryToolPorts = {
  findSubject: async () => ({ isSynthetic: true, cohortId: "synthea-v4-seed42" }),
  findObservations: async () => [],
  appendAudit: async () => undefined,
};

const run = (model: MockLanguageModelV4) =>
  new Promise<{ finish: TwinTurnFinish; firstTokens: number; audited: string[] }>(
    (resolve, reject) => {
      let firstTokens = 0;
      const audited: string[] = [];
      const result = runTwinTurn(
        {
          model,
          tools: createChatTools(
            { actor: "test", sessionId: "turn-1", mode: "synthetic" },
            { query: ports },
          ),
          mode: "synthetic",
          loadAudit: async (turnId): Promise<readonly ResponseToolCall[]> => {
            audited.push(turnId);
            return [];
          },
        },
        {
          turnId: "turn-1",
          messages: [
            { role: "user", content: "First question" },
            { role: "assistant", content: "First answer" },
            { role: "user", content: "Second question" },
          ],
          wearables: NO_WEARABLES,
        },
        {
          onFirstToken: () => {
            firstTokens += 1;
          },
          onFinish: async (finish) => {
            resolve({ finish, firstTokens, audited });
          },
          onError: async (error) => reject(error),
          onAbort: () => reject(new Error("aborted")),
        },
      );
      void result.consumeStream();
    },
  );

type HookEvent = "first-token" | "finish" | "error" | "abort";

/** Settles on whichever end hook fires first and reports every hook call in order. */
const hookEvents = (model: MockLanguageModelV4, abortSignal?: AbortSignal) =>
  new Promise<{ events: HookEvent[]; error: unknown }>((resolve) => {
    const events: HookEvent[] = [];
    const result = runTwinTurn(
      {
        model,
        tools: createChatTools(
          { actor: "test", sessionId: "turn-2", mode: "synthetic" },
          { query: ports },
        ),
        mode: "synthetic",
        loadAudit: async () => [],
      },
      {
        turnId: "turn-2",
        messages: [{ role: "user", content: "Question" }],
        wearables: NO_WEARABLES,
        abortSignal,
      },
      {
        onFirstToken: () => void events.push("first-token"),
        onFinish: async () => {
          events.push("finish");
          resolve({ events, error: null });
        },
        onError: async (error) => {
          events.push("error");
          resolve({ events, error });
        },
        onAbort: () => {
          events.push("abort");
          resolve({ events, error: null });
        },
      },
    );
    void Promise.resolve(result.consumeStream({ onError: () => undefined }));
  });

const CITATION: KnowledgeCitation = {
  tool: "knowledge.knowledge_search",
  id: "opentwin-metric-glossary",
  title: "Metric glossary",
  file: "knowledge/opentwin/metric-glossary.md",
  sectionHeading: "HRV",
  licence: "CC-BY-4.0",
};

/** A model that never answers, but stops when its signal fires, as a real fetch does. */
const abortableSilence = (signal: AbortSignal | undefined) =>
  new ReadableStream<never>({
    start: (controller) => {
      if (signal?.aborted) controller.error(signal.reason);
      signal?.addEventListener("abort", () => controller.error(signal.reason));
    },
  });

describe("runTwinTurn", () => {
  test("sends the synthetic-mode prompt, the messages and every chat tool", async () => {
    const model = new MockLanguageModelV4({ doStream: async () => streamOf(text("Hi")) });
    const { finish, firstTokens } = await run(model);

    const call = model.doStreamCalls[0];
    expect(call?.prompt[0]).toEqual({
      role: "system",
      content: buildTwinSystemPrompt({ mode: "synthetic", ...NO_WEARABLES }),
    });
    expect(
      call?.prompt
        .slice(1)
        .map((message) => [
          message.role,
          Array.isArray(message.content)
            ? message.content
                .map((part) => ("text" in part ? part.text : part.type))
                .join("")
            : message.content,
        ]),
    ).toEqual([
      ["user", "First question"],
      ["assistant", "First answer"],
      ["user", "Second question"],
    ]);
    expect((call?.tools ?? []).map((tool) => tool.name).sort()).toEqual(
      Object.keys(
        createChatTools({ actor: "test", sessionId: "turn-1", mode: "synthetic" }),
      ).sort(),
    );
    // Sampling is left to the provider, as the route always did.
    expect([call?.temperature, call?.topP, call?.maxOutputTokens, call?.seed]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(firstTokens).toBe(2);
    expect(finish.text).toBe("Hi more");
    expect(finish.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  });

  test("stops after eight steps, the last without tools, and builds the document from this turn's audit", async () => {
    // A model that calls a tool whenever it is offered one.
    const model = new MockLanguageModelV4({
      doStream: async ({ tools }) =>
        streamOf(
          (tools ?? []).length === 0 ? text("Answer") : toolCall(`call-${Math.random()}`),
        ),
    });
    const { finish, audited } = await run(model);

    expect(model.doStreamCalls.length).toBe(8);
    expect(model.doStreamCalls.map((call) => (call.tools ?? []).length > 0)).toEqual([
      ...Array.from({ length: 7 }, () => true),
      false,
    ]);
    expect(finish.text).toBe("Answer more");
    expect(finish.toolResults.map((result) => result.toolName)).toEqual(
      Array.from({ length: 7 }, () => "trend"),
    );
    expect(finish.toolResults[0]?.output).toEqual({
      loinc: "4548-4",
      unit: null,
      n: 0,
      first_at: null,
      last_at: null,
      slope_per_day: null,
      slope_unit: null,
      fitted_first: null,
      fitted_last: null,
    });

    const document = await finish.buildDocument();
    expect(audited).toEqual(["turn-1"]);
    expect([document.answer_class, document.abstained, document.next_step]).toEqual([
      "information",
      true,
      "more_data",
    ]);
  });

  test("a model error reaches onError with the error itself, and nothing else ends the turn", async () => {
    const failure = new Error("provider down");
    const model = new MockLanguageModelV4({
      doStream: async () => {
        throw failure;
      },
    });
    const { events, error } = await hookEvents(model);
    expect(events).toEqual(["error"]);
    expect(error).toBe(failure);
  });

  test("an aborted signal reaches onAbort, not onFinish", async () => {
    const controller = new AbortController();
    const model = new MockLanguageModelV4({
      doStream: async ({ abortSignal }) => {
        controller.abort(new DOMException("time limit", "TimeoutError"));
        return { stream: abortableSilence(abortSignal) };
      },
    });
    const { events } = await hookEvents(model, controller.signal);
    expect(events).toEqual(["abort"]);
  });

  test("the document takes this turn's collected sources and empties the collector", async () => {
    recordKnowledgeTurn("turn-1", [CITATION]);
    const model = new MockLanguageModelV4({ doStream: async () => streamOf(text("Hi")) });
    const { finish } = await run(model);

    const document = await finish.buildDocument();
    expect(document.data_basis.sources.knowledge).toEqual([CITATION]);
    expect(drainKnowledgeTurn("turn-1")).toEqual({ sources: [] });
  });
});
