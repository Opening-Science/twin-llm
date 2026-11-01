import {
  getToolName,
  isToolUIPart,
  parseJsonEventStream,
  readUIMessageStream,
  uiMessageChunkSchema,
  type UIMessageChunk,
} from "ai";

import type { EffortLevel } from "@/infrastructure/chat-effort";
import { type ChatView, viewsOf } from "@/infrastructure/chat-view";
import {
  PROVIDER_NOT_PERMITTED_FOR_DATA_MODE,
  PROVIDER_NOT_PERMITTED_SENTENCE,
} from "@/infrastructure/data-mode-policy";
import {
  GENOME_THREAD_LOCAL_ONLY,
  GENOME_THREAD_SENTENCE,
} from "@/infrastructure/genome-thread-policy";
import {
  INCOGNITO_LOCAL_ONLY,
  INCOGNITO_LOCAL_ONLY_SENTENCE,
} from "@/infrastructure/incognito";
import type {
  ChatUIMessage,
  ModelResponseMetrics,
} from "@/infrastructure/model-response-metrics";
import { NUMBER_REVIEW_PART } from "@/infrastructure/number-review";
import {
  type NumberSource,
  numberSources,
  type NumberSourcePart,
} from "@/infrastructure/number-sources";
import type { ResponseDocumentV1 } from "@/infrastructure/response-document/document-v1";
import { toResponseDocument } from "@/infrastructure/response-document/parse";
import { isSkillRefusalCode } from "@/infrastructure/skill-gate";
import type { UiContext } from "@/infrastructure/ui-context";

import type { ToolActivity } from "./conversation";
import { toolCard } from "./tool-cards";
import type { HistoryMessage } from "./turn-history";

/**
 * The browser end of one model's `POST /api/chat`.
 *
 * The server holds back `finish` until the answer is stored and its metrics and
 * response document are attached, so `finish` is the only proof the answer
 * landed. That gives three endings, and they are kept apart on purpose:
 * - COMPLETE: `finish` arrived and nothing errored.
 * - FAILED: the server or the reader reported an error, or the request never
 *   got a body.
 * - LOST: the body simply stopped. A quiet connection closed while the model
 *   was still thinking; the server keeps going and a reload shows the answer.
 */

export type StreamEnding = "COMPLETE" | "FAILED" | "LOST";

export type StreamResult = Readonly<{
  ending: StreamEnding;
  metrics: ModelResponseMetrics | null;
  document: ResponseDocumentV1 | null;
  /** The sentence for a refused turn (skill or data-mode policy); only ever set with FAILED. */
  refusal?: string;
  /** The answer's numbers a tool call holds, matched once the stream ends. */
  numberSources?: readonly NumberSource[];
}>;

export type StreamProgress = Readonly<{
  text: string;
  tools: readonly ToolActivity[];
  views: readonly ChatView[];
  /** An Ultra answer's number check has started and not yet come back (#366). */
  reviewing: boolean;
}>;

export type AnswerRequest = Readonly<{
  modelId: string;
  turnId: string;
  messages: readonly HistoryMessage[];
  /** The skill the turn was sent with; left out for an ordinary prompt. */
  skill?: string;
  /** What was on screen when it was sent (#47); left out when nothing was. */
  uiContext?: UiContext;
  /** The effort (#366); left out, Balanced. */
  effort?: EffortLevel;
}>;

/**
 * One answer of an incognito chat (`infrastructure/incognito.ts`). There is
 * no turn row, so no turn id; it goes to `/api/chat/incognito`, which keeps
 * nothing.
 */
export type IncognitoAnswerRequest = Readonly<{
  incognito: true;
  modelId: string;
  messages: readonly HistoryMessage[];
  skill?: string;
  effort?: EffortLevel;
}>;

export const CHAT_ENDPOINT = "/api/chat";
export const INCOGNITO_CHAT_ENDPOINT = "/api/chat/incognito";

/** Where a request goes and the body it sends; the incognito marker is not sent. */
export const answerCall = (
  request: AnswerRequest | IncognitoAnswerRequest,
): Readonly<{ endpoint: string; body: string }> => {
  if (!("incognito" in request)) {
    return { endpoint: CHAT_ENDPOINT, body: JSON.stringify(request) };
  }
  const { modelId, messages, skill, effort } = request;
  return {
    endpoint: INCOGNITO_CHAT_ENDPOINT,
    body: JSON.stringify({
      modelId,
      messages,
      ...(skill === undefined ? {} : { skill }),
      ...(effort === undefined ? {} : { effort }),
    }),
  };
};

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

const FAILED: StreamResult = Object.freeze({
  ending: "FAILED",
  metrics: null,
  document: null,
});

/**
 * A card per tool part, in order (`tool-cards.ts`). Named arguments and a row
 * count are kept; outputs stay behind. `rowCounts` carries a saved answer's
 * audit counts by call id.
 */
export const toolActivity = (
  parts: ChatUIMessage["parts"],
  rowCounts?: ReadonlyMap<string, number | null>,
): ToolActivity[] =>
  parts.flatMap((part) =>
    isToolUIPart(part)
      ? [
          toolCard(
            {
              toolCallId: part.toolCallId,
              tool: getToolName(part),
              state: part.state,
              input: part.input,
              output: part.state === "output-available" ? part.output : undefined,
            },
            rowCounts?.get(part.toolCallId),
          ),
        ]
      : [],
  );

/** The finished calls of a message, as the number matcher reads them. */
export const sourceParts = (parts: ChatUIMessage["parts"]): NumberSourcePart[] =>
  parts.flatMap((part) =>
    isToolUIPart(part) && part.state === "output-available"
      ? [{ toolCallId: part.toolCallId, input: part.input, output: part.output }]
      : [],
  );

/**
 * The sentence of a refused turn. A skill refusal's text is written by
 * TwinLLM itself, never by a provider, so it is shown as sent. The data-mode
 * refusal's text is for the operator (it names settings), so the column shows
 * the policy's fixed sentence for people instead, the same one the server
 * stores on the row. Anything else is no refusal.
 */
export const refusalOf = async (response: Response): Promise<string | null> => {
  if (response.status !== 400) return null;
  const body: unknown = await response.json().catch(() => null);
  if (typeof body !== "object" || body === null || !("code" in body)) return null;
  if (body.code === PROVIDER_NOT_PERMITTED_FOR_DATA_MODE) {
    return PROVIDER_NOT_PERMITTED_SENTENCE;
  }
  if (body.code === GENOME_THREAD_LOCAL_ONLY) return GENOME_THREAD_SENTENCE;
  if (body.code === INCOGNITO_LOCAL_ONLY) return INCOGNITO_LOCAL_ONLY_SENTENCE;
  return isSkillRefusalCode(body.code) &&
    "error" in body &&
    typeof body.error === "string"
    ? body.error
    : null;
};

/** The response document carried in a message's metadata, if it is a valid one. */
export const documentFromMetadata = (metadata: unknown): ResponseDocumentV1 | null => {
  if (typeof metadata !== "object" || metadata === null) return null;
  return "document" in metadata ? toResponseDocument(metadata.document) : null;
};

const textOf = (message: ChatUIMessage): string =>
  message.parts.map((part) => (part.type === "text" ? part.text : "")).join("");

/**
 * Valid chunks only, and a note of whether `finish` went past. A chunk that
 * fails the schema is dropped rather than ending the answer.
 */
const validChunks = (body: ReadableStream<Uint8Array>, onFinish: () => void) =>
  parseJsonEventStream({ stream: body, schema: uiMessageChunkSchema }).pipeThrough(
    new TransformStream<
      Readonly<{ success: boolean; value?: UIMessageChunk }>,
      UIMessageChunk
    >({
      transform: (result, controller) => {
        if (!result.success || !result.value) return;
        if (result.value.type === "finish") onFinish();
        controller.enqueue(result.value);
      },
    }),
  );

/** True once the stream announced a number check and before its document came back. */
export const reviewRunning = (message: ChatUIMessage): boolean =>
  message.metadata === undefined &&
  message.parts.some((part) => part.type === NUMBER_REVIEW_PART);

/**
 * `signal` is the Stop button (#366): aborting it closes this browser's
 * stream. The server is not told; a saved answer still finishes and is stored.
 */
export const streamAnswer = async (
  request: AnswerRequest | IncognitoAnswerRequest,
  onProgress: (progress: StreamProgress) => void,
  fetcher: Fetcher = fetch,
  signal?: AbortSignal,
): Promise<StreamResult> => {
  try {
    const { endpoint, body } = answerCall(request);
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      ...(signal === undefined ? {} : { signal }),
    });
    if (!response.ok || !response.body) {
      const refusal = await refusalOf(response);
      return refusal === null ? FAILED : { ...FAILED, refusal };
    }

    // Stream bookkeeping: the reader reports finish and errors through
    // callbacks, so these are written from them and read once at the end.
    let finished = false;
    let errored = false;
    let metrics: ModelResponseMetrics | null = null;
    let document: ResponseDocumentV1 | null = null;
    let last: ChatUIMessage | null = null;

    const snapshots = readUIMessageStream<ChatUIMessage>({
      stream: validChunks(response.body, () => {
        finished = true;
      }),
      onError: () => {
        errored = true;
      },
    });

    for await (const message of snapshots) {
      last = message;
      onProgress({
        text: textOf(message),
        tools: toolActivity(message.parts),
        views: viewsOf(message.parts),
        reviewing: reviewRunning(message),
      });
      if (message.metadata) {
        metrics = message.metadata;
        document = documentFromMetadata(message.metadata) ?? document;
      }
    }

    const ending: StreamEnding = errored ? "FAILED" : finished ? "COMPLETE" : "LOST";
    // The browser already holds the outputs it streamed; only the matches are kept.
    return ending === "COMPLETE" && last !== null
      ? {
          ending,
          metrics,
          document,
          numberSources: numberSources(textOf(last), sourceParts(last.parts)),
        }
      : { ending, metrics, document };
  } catch (error) {
    // The error's name only: an incognito answer leaves nothing in the console.
    console.error(
      `[arena] lost the stream for ${request.modelId}`,
      error instanceof Error ? error.name : typeof error,
    );
    return FAILED;
  }
};
