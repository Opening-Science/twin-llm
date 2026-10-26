import type { ModelResponseMetrics } from "@/infrastructure/model-response-metrics";
import type { EvidenceAttribution } from "@/infrastructure/oura-types";
import type { ResponseDocumentV1 } from "@/infrastructure/response-document/document-v1";

/**
 * The browser's picture of a conversation. A saved thread and a live one use
 * the same shapes, so the thread page hands its rows straight to the screen
 * and a reload looks like the session that produced it.
 *
 * An answer is built from three parts: which row and model it is, how far it
 * got, and what the server could say about it once it finished. The parts are
 * named so code that only needs one of them can say so.
 */

/** A tool call as the column shows it: a name and how far it got, never its input or output. */
export type ToolActivity = Readonly<{
  name: string;
  state: "running" | "done" | "error";
}>;

export type AnswerStatus = "STREAMING" | "COMPLETE" | "FAILED";

/** The `model_responses` row an answer lives in, and the model writing it. */
export type AnswerSource = Readonly<{ id: string; modelId: string; modelName: string }>;

/** What arrives while the answer streams. A saved answer carries `tools` from its stored tool parts. */
export type AnswerProgress = Readonly<{
  status: AnswerStatus;
  text: string;
  tools?: readonly ToolActivity[];
  /** The connection closed before the server said it was done. */
  lost?: boolean;
}>;

/** What is known once it is finished; each part may be missing. */
export type AnswerFindings = Readonly<{
  metrics: ModelResponseMetrics | null;
  reasoningText?: string | null;
  attribution?: readonly EvidenceAttribution[] | null;
  document?: ResponseDocumentV1 | null;
}>;

/** One model's answer to one prompt. */
export type ResponseState = AnswerSource & AnswerProgress & AnswerFindings;

/** One prompt and an answer per model it went to. */
export type TurnState = Readonly<{
  id: string;
  prompt: string;
  answers: readonly ResponseState[];
  /**
   * Shown at once while the server creates the rows. Its ids are made up, so
   * nothing may stream against it until the real turn replaces it.
   */
  pending?: boolean;
}>;
