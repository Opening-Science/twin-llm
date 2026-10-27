import type { ChatView } from "@/infrastructure/chat-view";
import type { ModelResponseMetrics } from "@/infrastructure/model-response-metrics";
import type { NumberSource } from "@/infrastructure/number-sources";
import type { EvidenceAttribution } from "@/infrastructure/oura-types";
import type { ResponseDocumentV1 } from "@/infrastructure/response-document/document-v1";

import type { ToolCard } from "./tool-cards";

/**
 * The browser's picture of a conversation. A saved thread and a live one use
 * the same shapes, so the thread page hands its rows straight to the screen
 * and a reload looks like the session that produced it.
 *
 * An answer is built from three parts: which row and model it is, how far it
 * got, and what the server could say about it once it finished. The parts are
 * named so code that only needs one of them can say so.
 */

/** A tool call as the column shows it (`tool-cards.ts`): named arguments and a row count, never its output. */
export type ToolActivity = ToolCard;

export type AnswerStatus = "STREAMING" | "COMPLETE" | "FAILED";

/** The `model_responses` row an answer lives in, and the model writing it. */
export type AnswerSource = Readonly<{ id: string; modelId: string; modelName: string }>;

/** What arrives while the answer streams. A saved answer carries `tools` from its stored tool parts. */
export type AnswerProgress = Readonly<{
  status: AnswerStatus;
  text: string;
  tools?: readonly ToolActivity[];
  /** Charts the server drew from audited rows; a saved answer reads them from its stored tool parts. */
  views?: readonly ChatView[];
  /** The connection closed before the server said it was done. */
  lost?: boolean;
  /** The server's own sentence for a refused skill turn, shown in place of the generic failure. */
  refusal?: string;
}>;

/** What is known once it is finished; each part may be missing. */
export type AnswerFindings = Readonly<{
  metrics: ModelResponseMetrics | null;
  reasoningText?: string | null;
  attribution?: readonly EvidenceAttribution[] | null;
  document?: ResponseDocumentV1 | null;
  /** When the answer finished, ISO 8601; the Outputs panel shows it. */
  completedAt?: string | null;
  /**
   * The answer's numbers a tool call holds, with the call and row
   * (`number-sources.ts`); never the value it read.
   */
  numberSources?: readonly NumberSource[];
}>;

/** One model's answer to one prompt. */
export type ResponseState = AnswerSource & AnswerProgress & AnswerFindings;

/** One prompt and an answer per model it went to. */
export type TurnState = Readonly<{
  id: string;
  prompt: string;
  answers: readonly ResponseState[];
  /** The skill the prompt was sent with (`sleep` for `/sleep`), or null. */
  skill?: string | null;
  /**
   * Shown at once while the server creates the rows. Its ids are made up, so
   * nothing may stream against it until the real turn replaces it.
   */
  pending?: boolean;
}>;
