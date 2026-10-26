import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type InferUIMessageChunk,
} from "ai";

import { DATA_VIEW_PART, SHOW_VIEW_TOOL, toChatView } from "@/infrastructure/chat-view";
import type {
  ChatUIMessage,
  ModelResponseMetrics,
} from "@/infrastructure/model-response-metrics";

/**
 * A slow local model can think for minutes before its first text token, and
 * the provider does not pass that thinking on, so the connection would carry
 * nothing at all. A proxy or browser may close a connection that quiet. The
 * AI SDK has no ping part, so a transient data part goes out instead: the
 * browser's `readUIMessageStream` skips it without touching the message.
 */
export const HEARTBEAT_INTERVAL_MS = 15_000;

type Chunk = InferUIMessageChunk<ChatUIMessage>;

/**
 * Passes every chunk on and, after a `show_view` call's output, adds a
 * `data-view` part with the view it returned. The view is built on the server
 * from audited rows (`show-view-tool.ts`); this only forwards it. A refusal is
 * not a view, so it adds nothing.
 */
export const withViewParts = (): TransformStream<Chunk, Chunk> => {
  const showViewCalls = new Set<string>();
  return new TransformStream<Chunk, Chunk>({
    transform: (chunk, controller) => {
      controller.enqueue(chunk);
      if (
        (chunk.type === "tool-input-start" || chunk.type === "tool-input-available") &&
        chunk.toolName === SHOW_VIEW_TOOL
      ) {
        showViewCalls.add(chunk.toolCallId);
        return;
      }
      if (chunk.type !== "tool-output-available") return;
      if (!showViewCalls.has(chunk.toolCallId)) return;
      const view = toChatView(chunk.output);
      if (view) controller.enqueue({ type: DATA_VIEW_PART, id: view.id, data: view });
    },
  });
};

/**
 * The browser's half of one turn. The model's own parts stream through as they
 * come, each view after the tool call that drew it, without their `finish` chunk; that waits for `finished`, so metadata
 * (metrics and the response document) always lands before the stream ends.
 * `finished` resolving to null still ends the stream, just without metadata.
 */
export const twinUIMessageResponse = ({
  modelStream,
  finished,
  onError,
  heartbeatMs = HEARTBEAT_INTERVAL_MS,
}: Readonly<{
  modelStream: ReadableStream<Chunk>;
  finished: Promise<ModelResponseMetrics | null>;
  onError: (error: unknown) => string;
  heartbeatMs?: number;
}>): Response =>
  createUIMessageStreamResponse({
    stream: createUIMessageStream<ChatUIMessage>({
      execute: async ({ writer }) => {
        writer.merge(modelStream.pipeThrough(withViewParts()));
        const heartbeat = setInterval(() => {
          writer.write({ type: "data-heartbeat", data: null, transient: true });
        }, heartbeatMs);
        const metadata = await finished.finally(() => clearInterval(heartbeat));
        if (metadata)
          writer.write({ type: "message-metadata", messageMetadata: metadata });
        writer.write({ type: "finish" });
      },
      onError,
    }),
  });
