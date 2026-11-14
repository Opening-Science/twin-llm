import {
  parseJsonEventStream,
  readUIMessageStream,
  uiMessageChunkSchema,
  type UIMessage,
  type UIMessageChunk,
} from "ai";

import type { EffortLevel } from "@/infrastructure/chat-effort";
import { type ChatView, viewsOf } from "@/infrastructure/chat-view";
import {
  PROVIDER_NOT_PERMITTED_FOR_DATA_MODE,
  PROVIDER_NOT_PERMITTED_SENTENCE,
} from "@/infrastructure/data-mode-policy";
import { GENOME_IDS_BLOCKED_SENTENCE } from "@/infrastructure/free-text-check";
import { type GbdProfileFrame, profileFrameOf } from "@/infrastructure/gbd-profile-frame";
import {
  GENOME_THREAD_LOCAL_ONLY,
  GENOME_THREAD_SENTENCE,
} from "@/infrastructure/genome-thread-policy";
import {
  INCOGNITO_LOCAL_ONLY,
  INCOGNITO_LOCAL_ONLY_SENTENCE,
} from "@/infrastructure/incognito";
import type { ModelResponseMetrics } from "@/infrastructure/model-response-metrics";
import type { NumberSourcePart } from "@/infrastructure/number-sources";
import { NUMBER_REVIEW_PART } from "@/infrastructure/number-review";
import type { ResponseDocumentV1 } from "@/infrastructure/response-document/document-v1";
import { toResponseDocument } from "@/infrastructure/response-document/parse";
import { isSkillRefusalCode } from "@/infrastructure/skill-gate";
import type { UiContext } from "@/infrastructure/ui-context";

import type { ToolCard } from "./conversation";
import { toolCardsOf, toolNameOf } from "./tool-cards";

/**
 * The browser's half of one answer column (SPEC 8.1–8.2, SERVER-SPEC 3.12):
 * one request, then the server-sent UI message stream read into progress
 * updates and one result. Only fixed TwinLLM sentences ever become a
 * refusal; any other text the server or a provider sent is dropped.
 */

export type HistoryMessage = Readonly<{ role: "user" | "assistant"; content: string }>;

/** One answer's request. Incognito sends no turn id and never on-screen context. */
export type AnswerRequest = Readonly<{
  modelId: string;
  turnId?: string;
  messages: readonly HistoryMessage[];
  skill?: string;
  uiContext?: UiContext;
  effort?: EffortLevel;
}>;

/** A same-origin POST; the default sends to the chat routes of this app. */
export type SendRequest = (path: string, init: RequestInit) => Promise<Response>;

export type StreamProgress = Readonly<{
  text: string;
  tools: readonly ToolCard[];
  views: readonly ChatView[];
  profileFrame: GbdProfileFrame | null;
  reviewing: boolean;
}>;

/** COMPLETE: finish arrived without an error; FAILED: an error; LOST: the body just stopped. */
export type StreamEnding = "COMPLETE" | "FAILED" | "LOST";

export type StreamResult = StreamProgress &
  Readonly<{
    ending: StreamEnding;
    /** A fixed TwinLLM sentence when no model ran, else null. */
    refusal: string | null;
    metrics: ModelResponseMetrics | null;
    document: ResponseDocumentV1 | null;
    /** Finished tool calls, for matching the answer's numbers. */
    toolParts: readonly NumberSourcePart[];
    /** The person stopped it; the caller has already marked the column. */
    aborted: boolean;
  }>;

export type StreamOptions = Readonly<{ incognito?: boolean; signal?: AbortSignal }>;

const CHAT_PATH = "/api/chat";
const INCOGNITO_PATH = "/api/chat/incognito";

/** Same-origin only (`tests/disclosures/outbound-paths.test.ts`). */
const sendToApp: SendRequest = (path, init) =>
  path === INCOGNITO_PATH ? fetch("/api/chat/incognito", init) : fetch("/api/chat", init);

const EMPTY: StreamProgress = Object.freeze({
  text: "",
  tools: Object.freeze([]) as readonly ToolCard[],
  views: Object.freeze([]) as readonly ChatView[],
  profileFrame: null,
  reviewing: false,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The body each route accepts; the incognito route is strict about extra fields. */
export const requestBody = (request: AnswerRequest, incognito: boolean): string =>
  JSON.stringify(
    incognito
      ? {
          modelId: request.modelId,
          messages: request.messages,
          ...(request.skill === undefined ? {} : { skill: request.skill }),
          ...(request.effort === undefined ? {} : { effort: request.effort }),
        }
      : {
          modelId: request.modelId,
          turnId: request.turnId,
          messages: request.messages,
          ...(request.skill === undefined ? {} : { skill: request.skill }),
          ...(request.uiContext === undefined ? {} : { uiContext: request.uiContext }),
          ...(request.effort === undefined ? {} : { effort: request.effort }),
        },
  );

/** The sentence a 400's code stands for; every other text is dropped. */
export const refusalOfBody = (body: unknown): string | null => {
  if (!isRecord(body)) return null;
  const { code, error } = body;
  if (code === PROVIDER_NOT_PERMITTED_FOR_DATA_MODE)
    return PROVIDER_NOT_PERMITTED_SENTENCE;
  if (code === GENOME_THREAD_LOCAL_ONLY) return GENOME_THREAD_SENTENCE;
  if (code === INCOGNITO_LOCAL_ONLY) return INCOGNITO_LOCAL_ONLY_SENTENCE;
  if (isSkillRefusalCode(code) && typeof error === "string") return error;
  return null;
};

const METRIC_KEYS = [
  "timeToFirstTokenMs",
  "tokensPerSecond",
  "inputTokens",
  "outputTokens",
  "totalTokens",
] as const;

const measured = (value: unknown): value is number | null =>
  value === null || (typeof value === "number" && Number.isFinite(value));

/** Metrics from the stream's metadata, or null when they are not well formed. */
export const metricsOf = (value: unknown): ModelResponseMetrics | null => {
  if (!isRecord(value)) return null;
  if (typeof value.modelId !== "string" || typeof value.costUsd !== "number") return null;
  if (!METRIC_KEYS.every((key) => measured(value[key]))) return null;
  return {
    modelId: value.modelId,
    timeToFirstTokenMs: value.timeToFirstTokenMs as number | null,
    tokensPerSecond: value.tokensPerSecond as number | null,
    inputTokens: value.inputTokens as number | null,
    outputTokens: value.outputTokens as number | null,
    totalTokens: value.totalTokens as number | null,
    costUsd: value.costUsd,
  };
};

type Metadata = Readonly<{
  metrics: ModelResponseMetrics | null;
  document: ResponseDocumentV1 | null;
}>;

/** `{ metrics, document }` as the server sends it; an invalid document is dropped. */
export const metadataOf = (value: unknown): Metadata | null =>
  isRecord(value)
    ? { metrics: metricsOf(value.metrics), document: toResponseDocument(value.document) }
    : null;

type Part = UIMessage["parts"][number];

const textOf = (parts: readonly Part[]): string =>
  parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");

const finishedToolParts = (parts: readonly Part[]): NumberSourcePart[] =>
  parts.flatMap((part) => {
    if (!("toolCallId" in part) || toolNameOf(part) === null) return [];
    if (part.state !== "output-available") return [];
    return [{ toolCallId: part.toolCallId, input: part.input, output: part.output }];
  });

/** Progress shown for one snapshot of the message. */
export const progressOf = (
  message: UIMessage,
  metadataArrived: boolean,
): StreamProgress => ({
  text: textOf(message.parts),
  tools: toolCardsOf(message.parts),
  views: viewsOf(message.parts),
  profileFrame: profileFrameOf(message.parts),
  reviewing:
    !metadataArrived && message.parts.some((part) => part.type === NUMBER_REVIEW_PART),
});

const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : typeof error;

const failed = (
  progress: StreamProgress,
  refusal: string | null = null,
  aborted = false,
): StreamResult => ({
  ...progress,
  ending: "FAILED",
  refusal,
  metrics: null,
  document: null,
  toolParts: [],
  aborted,
});

type Seen = { finish: boolean; error: string | null };

/** Watches the chunks for `finish` and `error` while passing them on. */
const watchChunks = (
  source: ReadableStream<UIMessageChunk>,
): Readonly<{ stream: ReadableStream<UIMessageChunk>; seen: Seen }> => {
  const seen: Seen = { finish: false, error: null };
  const stream = source.pipeThrough(
    new TransformStream<UIMessageChunk, UIMessageChunk>({
      transform: (chunk, controller) => {
        if (chunk.type === "finish") seen.finish = true;
        if (chunk.type === "error") seen.error ??= chunk.errorText;
        controller.enqueue(chunk);
      },
    }),
  );
  return { stream, seen };
};

/** Drops chunks that fail the UI chunk schema instead of failing the stream. */
const validChunks = (body: ReadableStream<Uint8Array>): ReadableStream<UIMessageChunk> =>
  parseJsonEventStream({ stream: body, schema: uiMessageChunkSchema }).pipeThrough(
    new TransformStream({
      transform: (result, controller) => {
        if (result.success) controller.enqueue(result.value);
      },
    }),
  );

/**
 * One answer, start to end. `onUpdate` gets every progress snapshot; the
 * result holds the ending and what the column keeps.
 */
export const streamAnswer = async (
  request: AnswerRequest,
  onUpdate: (progress: StreamProgress) => void,
  send: SendRequest = sendToApp,
  options: StreamOptions = {},
): Promise<StreamResult> => {
  const incognito = options.incognito === true;
  let progress: StreamProgress = EMPTY;
  try {
    const response = await send(incognito ? INCOGNITO_PATH : CHAT_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: requestBody(request, incognito),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    if (!response.ok || response.body === null) {
      const body: unknown =
        response.status === 400 ? await response.json().catch(() => null) : null;
      return failed(progress, refusalOfBody(body));
    }

    const { stream, seen } = watchChunks(validChunks(response.body));
    let metadata: Metadata | null = null;
    let parts: readonly Part[] = [];
    const messages = readUIMessageStream({
      stream,
      onError: () => undefined,
      terminateOnError: false,
    });
    for await (const message of messages) {
      if (message.metadata !== undefined) metadata = metadataOf(message.metadata);
      parts = message.parts;
      progress = progressOf(message, metadata !== null);
      onUpdate(progress);
    }
    if (options.signal?.aborted === true) return failed(progress, null, true);
    if (seen.error !== null) {
      return failed(
        progress,
        seen.error === GENOME_IDS_BLOCKED_SENTENCE ? GENOME_IDS_BLOCKED_SENTENCE : null,
      );
    }
    return {
      ...progress,
      reviewing: false,
      ending: seen.finish ? "COMPLETE" : "LOST",
      refusal: null,
      metrics: metadata?.metrics ?? null,
      document: metadata?.document ?? null,
      toolParts: finishedToolParts(parts),
      aborted: false,
    };
  } catch (error) {
    if (options.signal?.aborted === true) return failed(progress, null, true);
    // A model id and an error name only: no prompt or answer text, ever.
    console.error(`[chat] ${request.modelId} answer failed`, errorName(error));
    return failed(progress);
  }
};
