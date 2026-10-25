import {
  getToolName,
  isToolUIPart,
  parseJsonEventStream,
  readUIMessageStream,
  uiMessageChunkSchema,
  type UIMessageChunk,
} from "ai";

import type {
  ChatUIMessage,
  ModelResponseMetrics,
} from "@/infrastructure/model-response-metrics";
import type { ResponseDocumentV1 } from "@/infrastructure/response-document/document-v1";
import { toResponseDocument } from "@/infrastructure/response-document/parse";

import type { ToolActivity } from "./conversation";
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
}>;

export type StreamProgress = Readonly<{ text: string; tools: readonly ToolActivity[] }>;

export type AnswerRequest = Readonly<{
  modelId: string;
  turnId: string;
  messages: readonly HistoryMessage[];
}>;

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

const FAILED: StreamResult = Object.freeze({
  ending: "FAILED",
  metrics: null,
  document: null,
});

const STATE_OF: Readonly<Record<string, ToolActivity["state"]>> = {
  "output-available": "done",
  "output-error": "error",
  "output-denied": "error",
};

/** Name and progress of each tool part, in order. Inputs and outputs stay behind. */
export const toolActivity = (parts: ChatUIMessage["parts"]): ToolActivity[] =>
  parts.flatMap((part) =>
    isToolUIPart(part)
      ? [{ name: getToolName(part), state: STATE_OF[part.state] ?? "running" }]
      : [],
  );

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

export const streamAnswer = async (
  request: AnswerRequest,
  onProgress: (progress: StreamProgress) => void,
  fetcher: Fetcher = fetch,
): Promise<StreamResult> => {
  try {
    const response = await fetcher("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!response.ok || !response.body) return FAILED;

    // Stream bookkeeping: the reader reports finish and errors through
    // callbacks, so these four are written from them and read once at the end.
    let finished = false;
    let errored = false;
    let metrics: ModelResponseMetrics | null = null;
    let document: ResponseDocumentV1 | null = null;

    const snapshots = readUIMessageStream<ChatUIMessage>({
      stream: validChunks(response.body, () => {
        finished = true;
      }),
      onError: () => {
        errored = true;
      },
    });

    for await (const message of snapshots) {
      onProgress({ text: textOf(message), tools: toolActivity(message.parts) });
      if (message.metadata) {
        metrics = message.metadata;
        document = documentFromMetadata(message.metadata) ?? document;
      }
    }

    const ending: StreamEnding = errored ? "FAILED" : finished ? "COMPLETE" : "LOST";
    return { ending, metrics, document };
  } catch (error) {
    console.error(`[arena] lost the stream for ${request.modelId}`, error);
    return FAILED;
  }
};
