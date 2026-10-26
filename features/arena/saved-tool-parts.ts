import type { ChatUIMessage } from "@/infrastructure/model-response-metrics";
import { toStoredToolParts } from "@/infrastructure/model-response-tool-parts";

/**
 * The stored `toolParts` column as the tool parts the live stream ended with:
 * one `tool-<name>` part per call, in seq order, each with its output. A saved
 * answer then goes through the same `toolActivity` as a streamed one.
 */
export const savedToolParts = (column: unknown): ChatUIMessage["parts"] =>
  (toStoredToolParts(column) ?? []).map((part) => ({
    type: `tool-${part.tool}`,
    toolCallId: `${part.seq}`,
    state: "output-available",
    input: part.input,
    output: part.output,
  }));
