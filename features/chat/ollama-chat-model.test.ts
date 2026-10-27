import { describe, expect, test } from "bun:test";

import { generateText } from "ai";

import { ollamaChatModel } from "./ollama-chat-model";

const REPLY = JSON.stringify({
  model: "qwen3:4b",
  created_at: "2026-10-27T00:00:00Z",
  message: { role: "assistant", content: "Short." },
  done: true,
  done_reason: "stop",
  prompt_eval_count: 12,
  eval_count: 2,
});

const recordingFetch = () => {
  const calls: { url: string; body: unknown }[] = [];
  const fetchFn: typeof fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        body: JSON.parse(typeof init?.body === "string" ? init.body : "null"),
      });
      return new Response(REPLY, { headers: { "content-type": "application/json" } });
    },
    { preconnect: fetch.preconnect },
  );
  return { calls, fetchFn };
};

describe("ollamaChatModel", () => {
  test("posts to the native /api/chat with num_ctx and thinking off", async () => {
    const { calls, fetchFn } = recordingFetch();
    const result = await generateText({
      model: ollamaChatModel("qwen3:4b", {
        baseUrl: "http://127.0.0.1:11434/v1",
        numCtx: 16_384,
        fetch: fetchFn,
      }),
      prompt: "Hi",
    });
    expect(result.text).toBe("Short.");
    expect(calls.map((call) => call.url)).toEqual(["http://127.0.0.1:11434/api/chat"]);
    expect(calls[0]?.body).toMatchObject({
      model: "qwen3:4b",
      think: false,
      options: { num_ctx: 16_384 },
      stream: false,
    });
  });

  test("a base URL without /v1 or with a trailing slash reaches the same root", async () => {
    const { calls, fetchFn } = recordingFetch();
    await generateText({
      model: ollamaChatModel("qwen3:4b", {
        baseUrl: "http://localhost:11434/",
        numCtx: 32_768,
        fetch: fetchFn,
      }),
      prompt: "Hi",
    });
    expect(calls.map((call) => call.url)).toEqual(["http://localhost:11434/api/chat"]);
    expect(calls[0]?.body).toMatchObject({ options: { num_ctx: 32_768 } });
  });
});
