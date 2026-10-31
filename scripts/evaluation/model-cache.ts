/**
 * Record and replay for every model call the eval harness makes (C3a).
 *
 * A language-model middleware sits between `streamText` and the provider. It
 * hashes what the model would see (provider, model id, the full prompt with
 * every tool result so far, the tool definitions, the sampling params) plus the
 * repeat index, so each repeat of a consistency item is its own sample rather
 * than a copy of the first. A hit replays the recorded stream parts; in
 * `replay` mode a miss throws `CacheMissError` and no model is ever called.
 *
 * Tools are not cached: on replay they run again against the same synthetic
 * cohort, and an unchanged tool result gives the same next prompt and so the
 * same key. A changed result is a miss, which is the point.
 *
 * The store holds text and this module parses it, so an unreadable entry (a
 * run killed mid-write before writes were atomic, a hand edit) is handled in
 * one place: re-recorded in normal mode, `CACHE_CORRUPT` in replay.
 */
import {
  type LanguageModel,
  type LanguageModelMiddleware,
  simulateReadableStream,
  wrapLanguageModel,
} from "ai";
import { z } from "zod";

import { sha256Hex, toCanonicalJson } from "../../packages/audit/hash";

import type { CacheArm } from "./context-arm";

type WrapStreamOptions = Parameters<
  NonNullable<LanguageModelMiddleware["wrapStream"]>
>[0];
type CallOptions = WrapStreamOptions["params"];
type StreamResult = Awaited<ReturnType<WrapStreamOptions["doStream"]>>;
type StreamPart =
  StreamResult["stream"] extends ReadableStream<infer Part> ? Part : never;

export const CACHE_SCHEMA_VERSION = "twin-llm.eval.model-cache.v1";

/** Call options that change what the model samples; all go into the key. */
export const SAMPLING_FIELDS = [
  "maxOutputTokens",
  "temperature",
  "stopSequences",
  "topP",
  "topK",
  "presencePenalty",
  "frequencyPenalty",
  "responseFormat",
  "seed",
  "toolChoice",
] as const;

export const cacheEntrySchema = z
  .object({
    schema_version: z.literal(CACHE_SCHEMA_VERSION),
    key: z.string().regex(/^[0-9a-f]{64}$/),
    provider: z.string(),
    model_id: z.string(),
    /** True when a fake model produced this entry; replaying it stays MOCK. */
    mock: z.boolean(),
    /** Stream parts as recorded; dates are `{ "$date": iso }`. */
    parts: z.array(z.unknown()),
  })
  .strict();

export type CacheEntry = z.infer<typeof cacheEntrySchema>;

export type CacheStore = Readonly<{
  /** The stored text for a key, or null when there is none. */
  read: (key: string) => Promise<string | null>;
  /** Must be atomic: a reader never sees half an entry. */
  write: (key: string, text: string) => Promise<void>;
}>;

export class CacheMissError extends Error {
  readonly code = "CACHE_MISS";

  constructor(readonly key: string) {
    super(`CACHE_MISS: no recorded model call for key ${key}`);
    this.name = "CacheMissError";
  }
}

export class CacheCorruptError extends Error {
  readonly code = "CACHE_CORRUPT";

  constructor(readonly key: string) {
    super(`CACHE_CORRUPT: the recorded model call for key ${key} cannot be read`);
    this.name = "CacheCorruptError";
  }
}

const CORRUPT = Symbol("corrupt");

/** An entry that is not JSON, fails the schema or names another key is corrupt. */
export const parseCacheEntry = (
  text: string,
  key: string,
): CacheEntry | typeof CORRUPT => {
  try {
    const parsed = cacheEntrySchema.safeParse(JSON.parse(text) as unknown);
    return parsed.success && parsed.data.key === key ? parsed.data : CORRUPT;
  } catch {
    return CORRUPT;
  }
};

export type CacheKeyInput = Readonly<{
  provider: string;
  modelId: string;
  repeat: number;
  params: CallOptions;
  /**
   * The eval arm (#302) as the key names it (`cacheArm`). The tools arm
   * leaves it out, so its keys are the ones recorded before arms existed.
   */
  arm?: CacheArm;
}>;

export const samplingParams = (params: CallOptions): Record<string, unknown> =>
  Object.fromEntries(
    SAMPLING_FIELDS.filter((field) => params[field] !== undefined).map((field) => [
      field,
      params[field],
    ]),
  );

export const cacheKey = ({
  provider,
  modelId,
  repeat,
  params,
  arm = "tools",
}: CacheKeyInput): string =>
  sha256Hex(
    toCanonicalJson({
      ...(arm === "tools" ? {} : { arm }),
      provider,
      model_id: modelId,
      repeat,
      prompt: params.prompt,
      tools: params.tools ?? [],
      sampling: samplingParams(params),
    }),
  );

const DATE_TAG = "$date";

/** JSON cannot hold a Date; response metadata carries one. */
export const serializeParts = (parts: readonly StreamPart[]): unknown[] =>
  JSON.parse(
    JSON.stringify(parts, function replacer(this: unknown, key: string, value: unknown) {
      const original: unknown =
        typeof this === "object" && this !== null ? Reflect.get(this, key) : undefined;
      return original instanceof Date ? { [DATE_TAG]: original.toISOString() } : value;
    }),
  ) as unknown[];

const reviveDates = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(reviveDates);
  if (value !== null && typeof value === "object") {
    const tagged = Reflect.get(value, DATE_TAG);
    if (Object.keys(value).length === 1 && typeof tagged === "string") {
      return new Date(tagged);
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, reviveDates(inner)]),
    );
  }
  return value;
};

export const deserializeParts = (parts: readonly unknown[]): StreamPart[] =>
  parts.map(reviveDates) as StreamPart[];

export type CacheStats = Readonly<{ hits: number; misses: number; mock: boolean }>;

export type CachedModel = Readonly<{
  model: LanguageModel;
  /** Hits, misses and whether any answer came from a fake model, for this turn. */
  stats: () => CacheStats;
}>;

export const createCachedModel = (input: {
  /** A model object; a bare gateway id string cannot be wrapped. */
  readonly model: Exclude<LanguageModel, string>;
  readonly provider: string;
  readonly modelId: string;
  readonly repeat: number;
  /** The eval arm (#302) as the key names it; left out, `tools`. */
  readonly arm?: CacheArm;
  /** The wrapped model is a fake: everything it records is MOCK. */
  readonly mock: boolean;
  readonly replay: boolean;
  readonly store: CacheStore;
  /** Normal mode only: an unreadable entry is recorded again; this logs its key. */
  readonly onCorrupt: (key: string) => void;
}): CachedModel => {
  // Per-turn counters, sealed in this closure like the response timer.
  let hits = 0;
  let misses = 0;
  let mock = false;

  const middleware: LanguageModelMiddleware = {
    wrapGenerate: async () => {
      // streamText only streams; a generate call would bypass the cache.
      throw new Error("the eval harness records streamed calls only");
    },
    wrapStream: async ({ doStream, params }) => {
      const key = cacheKey({
        provider: input.provider,
        modelId: input.modelId,
        repeat: input.repeat,
        params,
        arm: input.arm,
      });
      const text = await input.store.read(key);
      const parsed = text === null ? null : parseCacheEntry(text, key);
      if (parsed === CORRUPT) {
        if (input.replay) throw new CacheCorruptError(key);
        input.onCorrupt(key);
      }
      const entry = parsed === CORRUPT ? null : parsed;
      if (entry) {
        hits += 1;
        mock = mock || entry.mock;
        return {
          stream: simulateReadableStream({
            chunks: deserializeParts(entry.parts),
            initialDelayInMs: null,
            chunkDelayInMs: null,
          }),
        };
      }
      if (input.replay) throw new CacheMissError(key);

      misses += 1;
      mock = mock || input.mock;
      const result = await doStream();
      const recorded: StreamPart[] = [];
      let failed = false;
      const record = new TransformStream<StreamPart, StreamPart>({
        transform: (part, controller) => {
          if (part.type === "error") failed = true;
          if (part.type !== "raw") recorded.push(part);
          controller.enqueue(part);
        },
        // A failed or cut-off call is never stored, so a replay cannot pass it off as an answer.
        flush: async () => {
          if (failed) return;
          const entry: CacheEntry = {
            schema_version: CACHE_SCHEMA_VERSION,
            key,
            provider: input.provider,
            model_id: input.modelId,
            mock: input.mock,
            parts: serializeParts(recorded),
          };
          await input.store.write(key, JSON.stringify(entry));
        },
      });
      return { ...result, stream: result.stream.pipeThrough(record) };
    },
  };

  return {
    model: wrapLanguageModel({ model: input.model, middleware }),
    stats: () => ({ hits, misses, mock }),
  };
};

type CacheError = CacheMissError | CacheCorruptError;

/** Finds a cache miss or corrupt entry behind the SDK's retry and wrapper errors. */
export const findCacheError = (error: unknown, depth = 0): CacheError | null => {
  if (error instanceof CacheMissError || error instanceof CacheCorruptError) return error;
  if (depth > 4 || error === null || typeof error !== "object") return null;
  const nested = [
    Reflect.get(error, "cause"),
    Reflect.get(error, "lastError"),
    ...(Array.isArray(Reflect.get(error, "errors"))
      ? (Reflect.get(error, "errors") as unknown[])
      : []),
  ];
  return (
    nested
      .map((inner) => findCacheError(inner, depth + 1))
      .find((found) => found !== null) ?? null
  );
};
