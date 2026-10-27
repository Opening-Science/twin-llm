import { describe, expect, test } from "bun:test";

import type { InferUIMessageChunk } from "ai";

import { twinUIMessageResponse } from "@/features/chat/twin-ui-stream";
import type {
  ChatUIMessage,
  ModelResponseMetrics,
} from "@/infrastructure/model-response-metrics";

import { type StreamProgress, streamAnswer } from "./answer-stream";
import { streamingView } from "./streaming-view";

/**
 * The browser reader against the server's real response wrapper. The model
 * side is a scripted chunk stream: it thinks, goes quiet long enough for
 * heartbeats, then answers in pieces. Synthetic text only.
 */

type Chunk = InferUIMessageChunk<ChatUIMessage>;

const ANSWER =
  "## Reasoning\nSynthetic reasoning.\n\n## Evidence Used\n- none\n\n## Answer\nSynthetic answer.\n\n## Uncertainty\nSynthetic caveat.";

const METRICS: ModelResponseMetrics = {
  modelId: "synthetic-thinker",
  timeToFirstTokenMs: 140,
  tokensPerSecond: 3.5,
  inputTokens: 12,
  outputTokens: 30,
  totalTokens: 42,
  costUsd: 0,
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const THINKING: readonly Chunk[] = [
  { type: "start" },
  { type: "start-step" },
  { type: "reasoning-start", id: "r1" },
  { type: "reasoning-delta", id: "r1", delta: "Synthetic private thought." },
  { type: "reasoning-end", id: "r1" },
];

const pieces = (text: string, size: number): string[] =>
  Array.from({ length: Math.ceil(text.length / size) }, (_, i) =>
    text.slice(i * size, (i + 1) * size),
  );

/** A model stream that thinks, pauses past two heartbeats, then writes `text`. */
const scriptedModel = (text: string, extra: readonly Chunk[] = []) =>
  new ReadableStream<Chunk>({
    start: async (controller) => {
      THINKING.forEach((chunk) => controller.enqueue(chunk));
      await wait(60);
      extra.forEach((chunk) => controller.enqueue(chunk));
      controller.enqueue({ type: "text-start", id: "t1" });
      for (const delta of pieces(text, 17)) {
        controller.enqueue({ type: "text-delta", id: "t1", delta });
        await wait(1);
      }
      controller.enqueue({ type: "text-end", id: "t1" });
      controller.enqueue({ type: "finish-step" });
      controller.close();
    },
  });

const serverResponse = (
  modelStream: ReadableStream<Chunk>,
  finished: Promise<ModelResponseMetrics | null> = Promise.resolve(METRICS),
) =>
  twinUIMessageResponse({
    modelStream,
    finished: modelStreamDone(finished),
    onError: () => "This model didn't come back.",
    heartbeatMs: 20,
  });

/** The server writes metadata only after the model has finished; give it a moment. */
const modelStreamDone = async (metrics: Promise<ModelResponseMetrics | null>) => {
  await wait(120);
  return metrics;
};

const run = async (response: Response) => {
  const updates: StreamProgress[] = [];
  const raw: string[] = [];
  const result = await streamAnswer(
    {
      modelId: "synthetic-thinker",
      turnId: "turn-1",
      messages: [{ role: "user", content: "q" }],
    },
    (progress) => updates.push(progress),
    async () => {
      const [mine, copy] = response.body!.tee();
      void new Response(copy).text().then((text) => raw.push(text));
      return new Response(mine, { status: response.status, headers: response.headers });
    },
  );
  await wait(5);
  return { result, updates, raw: raw.join("") };
};

describe("streamAnswer", () => {
  test("a long think then an answer ends COMPLETE with the server's metrics", async () => {
    const { result, updates, raw } = await run(serverResponse(scriptedModel(ANSWER)));

    expect(result.ending).toBe("COMPLETE");
    expect(result.metrics).toMatchObject(METRICS);
    expect(updates.at(-1)?.text).toBe(ANSWER);
    expect(streamingView(updates.at(-1)?.text ?? "")).toEqual({
      kind: "answer",
      text: "Synthetic answer.",
    });
    expect(raw).toContain('{"type":"data-heartbeat","data":null,"transient":true}');
  });

  test("tool calls show as cards with named arguments, never outputs", async () => {
    const { updates } = await run(
      serverResponse(
        scriptedModel("## Answer\nSynthetic.", [
          {
            type: "tool-input-available",
            toolCallId: "c1",
            toolName: "query_observations",
            input: { subject_ref: "synthetic-1" },
          },
          {
            type: "tool-output-available",
            toolCallId: "c1",
            output: { rows: [{ value: 41 }] },
          },
          {
            type: "tool-input-available",
            toolCallId: "c2",
            toolName: "guideline_search",
            input: { q: "synthetic" },
          },
        ]),
      ),
    );
    expect(updates.at(-1)?.tools).toEqual([
      {
        id: "c1",
        tool: "query_observations",
        title: "Query observations",
        args: [{ label: "Subject", value: "synthetic-1" }],
        state: "done",
        rowCount: 1,
        note: null,
      },
      {
        id: "c2",
        tool: "guideline_search",
        title: "Searched guidelines",
        args: [],
        state: "running",
        rowCount: null,
        note: null,
      },
    ]);
  });

  test("a body that closes during the think is LOST, not FAILED", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        THINKING.forEach((chunk) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`)),
        );
        controller.close();
      },
    });
    const { result, updates } = await run(
      new Response(body, { headers: { "content-type": "text/event-stream" } }),
    );
    expect(result).toEqual({ ending: "LOST", metrics: null, document: null });
    expect(updates.map((update) => update.text)).toEqual(updates.map(() => ""));
  });

  test("a refused request is FAILED", async () => {
    const refused = Response.json(
      { error: "That turn isn't yours to answer." },
      { status: 403 },
    );
    const result = await streamAnswer(
      { modelId: "m", turnId: "t", messages: [{ role: "user", content: "q" }] },
      () => {},
      async () => refused,
    );
    expect(result).toEqual({ ending: "FAILED", metrics: null, document: null });
  });

  test("an error part from the server is FAILED even though finish follows", async () => {
    const failing = new ReadableStream<Chunk>({
      start: (controller) => {
        controller.enqueue({ type: "start" });
        controller.enqueue({ type: "error", errorText: "This model didn't come back." });
        controller.close();
      },
    });
    const { result } = await run(serverResponse(failing, Promise.resolve(null)));
    expect(result.ending).toBe("FAILED");
  });

  test("a refused skill turn is FAILED and carries the server's own sentence", async () => {
    const sentence =
      "/sleep runs only on local Ollama. The models here come from OpenRouter, so /sleep did not run. Ask without /sleep instead.";
    const sent: string[] = [];
    const result = await streamAnswer(
      {
        modelId: "m",
        turnId: "t",
        messages: [{ role: "user", content: "last 7 nights" }],
        skill: "sleep",
      },
      () => {},
      async (_url, init) => {
        sent.push(String(init.body));
        return Response.json(
          { code: "provider-not-allowed-by-skill", error: sentence },
          { status: 400 },
        );
      },
    );
    expect(result).toEqual({
      ending: "FAILED",
      metrics: null,
      document: null,
      refusal: sentence,
    });
    expect(JSON.parse(sent[0] ?? "{}")).toMatchObject({ skill: "sleep" });
  });

  test("a data-mode refusal shows the policy's sentence, never the server's wording", async () => {
    const result = await streamAnswer(
      { modelId: "m", turnId: "t", messages: [{ role: "user", content: "q" }] },
      () => {},
      async () =>
        Response.json(
          { code: "PROVIDER_NOT_PERMITTED_FOR_DATA_MODE", error: "internal wording" },
          { status: 400 },
        ),
    );
    expect(result).toEqual({
      ending: "FAILED",
      metrics: null,
      document: null,
      refusal:
        "This model provider may not receive personal data or wearable context, so this model did not run.",
    });
  });

  test("any other refusal text never reaches the column", async () => {
    const result = await streamAnswer(
      { modelId: "m", turnId: "t", messages: [{ role: "user", content: "q" }] },
      () => {},
      async () =>
        Response.json(
          { code: "SOMETHING_ELSE", error: "internal wording" },
          { status: 400 },
        ),
    );
    expect(result).toEqual({ ending: "FAILED", metrics: null, document: null });
  });
});
