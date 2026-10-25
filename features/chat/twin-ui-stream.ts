import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type InferUIMessageChunk,
} from "ai";

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

/**
 * The browser's half of one turn. The model's own parts stream through as they
 * come, without their `finish` chunk; that waits for `finished`, so metadata
 * (metrics and the response document) always lands before the stream ends.
 * `finished` resolving to null still ends the stream, just without metadata.
 */
export const twinUIMessageResponse = ({
  modelStream,
  finished,
  onError,
  heartbeatMs = HEARTBEAT_INTERVAL_MS,
}: Readonly<{
  modelStream: ReadableStream<InferUIMessageChunk<ChatUIMessage>>;
  finished: Promise<ModelResponseMetrics | null>;
  onError: (error: unknown) => string;
  heartbeatMs?: number;
}>): Response =>
  createUIMessageStreamResponse({
    stream: createUIMessageStream<ChatUIMessage>({
      execute: async ({ writer }) => {
        writer.merge(modelStream);
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
