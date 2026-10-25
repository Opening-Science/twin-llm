import { describe, expect, test } from "bun:test";

import { streamText } from "ai";
import { MockLanguageModelV4 } from "ai/test";

import {
  CacheCorruptError,
  cacheKey,
  CacheMissError,
  type CacheStore,
  createCachedModel,
  deserializeParts,
  findCacheError,
  parseCacheEntry,
  serializeParts,
} from "./model-cache";

const usage = {
  inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 2, text: 2, reasoning: undefined },
};

const parts = (delta: string) => [
  { type: "stream-start", warnings: [] },
  {
    type: "response-metadata",
    id: "r",
    modelId: "fake",
    timestamp: new Date("2026-10-20T08:00:00.000Z"),
  },
  { type: "text-start", id: "t" },
  { type: "text-delta", id: "t", delta },
  { type: "text-end", id: "t" },
  { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
];

const streamOf = (chunks: readonly Record<string, unknown>[]) => ({
  stream: new ReadableStream({
    start: (controller) => {
      chunks.forEach((part) => controller.enqueue(part as never));
      controller.close();
    },
  }),
});

const memory = () => {
  const entries = new Map<string, string>();
  const store: CacheStore = {
    read: async (key) => entries.get(key) ?? null,
    write: async (key, text) => {
      entries.set(key, text);
    },
  };
  return { entries, store };
};

/** The text, or the error `streamText` reports through `onError` (as the runner reads it). */
const ask = async (
  model: Parameters<typeof streamText>[0]["model"],
): Promise<Readonly<{ text: string; error: unknown }>> => {
  let error: unknown = null;
  const result = streamText({
    model,
    prompt: "Hello",
    maxRetries: 0,
    onError: (event) => {
      error = event.error;
    },
  });
  await result.consumeStream();
  const text = error === null ? await result.text : "";
  return { text, error };
};

const PARAMS = { prompt: [{ role: "user" as const, content: [] }] };

describe("cacheKey", () => {
  test("changes with the repeat, the model and a sampling param, not with headers", () => {
    const base = { provider: "ollama", modelId: "a", repeat: 1, params: PARAMS };
    const key = cacheKey(base);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(cacheKey({ ...base, repeat: 2 })).not.toBe(key);
    expect(cacheKey({ ...base, modelId: "b" })).not.toBe(key);
    expect(cacheKey({ ...base, params: { ...PARAMS, temperature: 0 } })).not.toBe(key);
    expect(cacheKey({ ...base, params: { ...PARAMS, headers: { "x-run": "1" } } })).toBe(
      key,
    );
  });
});

describe("serializeParts", () => {
  test("keeps dates through JSON", () => {
    const stored = JSON.parse(
      JSON.stringify(serializeParts(parts("x") as never)),
    ) as unknown[];
    expect(stored[1]).toEqual({
      type: "response-metadata",
      id: "r",
      modelId: "fake",
      timestamp: { $date: "2026-10-20T08:00:00.000Z" },
    });
    expect(deserializeParts(stored)[1]).toEqual(parts("x")[1] as never);
  });
});

describe("createCachedModel", () => {
  test("records a miss, then answers the same call from the cache", async () => {
    const cache = memory();
    const model = new MockLanguageModelV4({
      doStream: async () => streamOf(parts("Hi")),
    });
    const make = (replay: boolean) =>
      createCachedModel({
        model,
        provider: "ollama",
        modelId: "a",
        repeat: 1,
        mock: true,
        replay,
        store: cache.store,
        onCorrupt: () => undefined,
      });

    const recording = make(false);
    expect(await ask(recording.model)).toEqual({ text: "Hi", error: null });
    expect(recording.stats()).toEqual({ hits: 0, misses: 1, mock: true });
    expect(
      [...cache.entries.values()].map(
        (text) => (JSON.parse(text) as { mock: boolean }).mock,
      ),
    ).toEqual([true]);

    const replay = make(true);
    expect(await ask(replay.model)).toEqual({ text: "Hi", error: null });
    expect(replay.stats()).toEqual({ hits: 1, misses: 0, mock: true });
    expect(model.doStreamCalls.length).toBe(1);
  });

  test("a replay miss throws CacheMissError and calls nothing", async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => streamOf(parts("Hi")),
    });
    const cached = createCachedModel({
      model,
      provider: "ollama",
      modelId: "a",
      repeat: 1,
      mock: false,
      replay: true,
      store: memory().store,
      onCorrupt: () => undefined,
    });
    const { error } = await ask(cached.model);
    expect(findCacheError(error)?.code).toBe("CACHE_MISS");
    expect(model.doStreamCalls.length).toBe(0);
  });

  test("a stream that errors is not stored", async () => {
    const cache = memory();
    const model = new MockLanguageModelV4({
      doStream: async () =>
        streamOf([
          { type: "stream-start", warnings: [] },
          { type: "error", error: new Error("provider said no") },
        ]),
    });
    const cached = createCachedModel({
      model,
      provider: "ollama",
      modelId: "a",
      repeat: 1,
      mock: false,
      replay: false,
      store: cache.store,
      onCorrupt: () => undefined,
    });
    expect((await ask(cached.model)).error).toEqual(new Error("provider said no"));
    expect(cache.entries.size).toBe(0);
  });

  test("findCacheError looks through cause and retry wrappers", () => {
    const miss = new CacheMissError("f".repeat(64));
    const corrupt = new CacheCorruptError("e".repeat(64));
    expect(findCacheError({ lastError: { cause: miss } })).toBe(miss);
    expect(findCacheError({ errors: [new Error("x"), corrupt] })).toBe(corrupt);
    expect(findCacheError(new Error("other"))).toBeNull();
  });
});

describe("parseCacheEntry", () => {
  const key = "a".repeat(64);
  const entry = {
    schema_version: "twin-llm.eval.model-cache.v1",
    key,
    provider: "ollama",
    model_id: "a",
    mock: false,
    parts: [],
  };

  test("reads a whole entry and rejects a cut, invalid or misfiled one", () => {
    const text = JSON.stringify(entry);
    expect(parseCacheEntry(text, key)).toEqual(entry);
    const rejected = [
      parseCacheEntry(text.slice(0, 30), key),
      parseCacheEntry(JSON.stringify({ ...entry, mock: "no" }), key),
      parseCacheEntry(text, "b".repeat(64)),
    ];
    expect(rejected.map((result) => typeof result)).toEqual([
      "symbol",
      "symbol",
      "symbol",
    ]);
  });
});
