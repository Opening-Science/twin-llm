import { viewsOf } from "@/infrastructure/chat-view";
import { profileFrameOf } from "@/infrastructure/gbd-profile-frame";
import { toStoredToolParts } from "@/infrastructure/model-response-tool-parts";
import { numberSources } from "@/infrastructure/number-sources";
import type { EvidenceAttribution } from "@/infrastructure/oura-types";
import { toResponseDocument } from "@/infrastructure/response-document/parse";

import { toolActivity } from "./answer-stream";
import type { ResponseState } from "./conversation";
import { savedToolParts } from "./saved-tool-parts";

/** Prisma `Decimal` or a plain number; both convert with `Number()`. */
type NumericLike = number | Readonly<{ toString: () => string }>;

export type SavedResponseRow = Readonly<{
  id: string;
  modelId: string;
  modelName: string;
  /** Index among the models picked for the turn; null on older rows. */
  position: number | null;
  /** REFUSED: no model ran, and `text` is TwinLLM's refusal sentence. */
  status: ResponseState["status"] | "REFUSED";
  text: string;
  reasoningText: string | null;
  attribution: unknown;
  responseDocument: unknown;
  toolParts: unknown;
  timeToFirstTokenMs: number | null;
  tokensPerSecond: NumericLike | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  costUsd: NumericLike;
  /** Null while streaming; left out by callers that do not read it. */
  completedAt?: Date | null;
}>;

/**
 * One saved `model_responses` row as the arena holds it. The stored response
 * document is validated here, the same way the live stream's is.
 *
 * An answer the document withholds (abstained or declined) leaves the server
 * without its text or reasoning: the column only ever shows the banner for it,
 * so the words have no reason to reach the browser.
 *
 * The stored tool parts are replayed as the stream's tool parts and reduced to
 * the same cards, with the audit row's count, so outputs stay on the server.
 * The one exception is a `show_view` output: it is the view itself, so a
 * reloaded answer draws the same chart it streamed. The answer's numbers are
 * matched to the stored outputs here (`number-sources.ts`), so the browser gets
 * which call and row holds each number, not what the row says.
 *
 * A refused row reads the way the live refusal did: a failed answer carrying
 * the stored sentence and no text. It is not STREAMING, so a reload does not
 * ask the model again.
 */
export const toSavedResponseState = (row: SavedResponseRow): ResponseState => {
  if (row.status === "REFUSED") {
    return {
      id: row.id,
      modelId: row.modelId,
      modelName: row.modelName,
      status: "FAILED",
      text: "",
      refusal: row.text,
      completedAt: row.completedAt?.toISOString() ?? null,
      metrics: null,
    };
  }
  const parts = savedToolParts(row.toolParts);
  const stored = toStoredToolParts(row.toolParts) ?? [];
  const rowCounts = new Map(stored.map((part) => [String(part.seq), part.rowCount]));
  const document = toResponseDocument(row.responseDocument);
  const withheld =
    document?.abstained === true ||
    document?.answer_class === "declined_decision_support";
  return {
    id: row.id,
    modelId: row.modelId,
    modelName: row.modelName,
    status: row.status,
    text: withheld ? "" : row.text,
    reasoningText: withheld ? null : row.reasoningText,
    attribution: (row.attribution as EvidenceAttribution[] | null) ?? null,
    document,
    completedAt: row.completedAt?.toISOString() ?? null,
    tools: toolActivity(parts, rowCounts),
    numberSources:
      withheld || row.status !== "COMPLETE"
        ? []
        : numberSources(
            row.text,
            stored.map((part) => ({
              toolCallId: String(part.seq),
              input: part.input,
              output: part.output,
            })),
          ),
    views: withheld ? [] : viewsOf(parts),
    profileFrame: withheld ? null : profileFrameOf(parts),
    metrics:
      row.status === "COMPLETE"
        ? {
            modelId: row.modelId,
            timeToFirstTokenMs: row.timeToFirstTokenMs,
            tokensPerSecond: row.tokensPerSecond ? Number(row.tokensPerSecond) : null,
            inputTokens: row.inputTokens,
            outputTokens: row.outputTokens,
            totalTokens: row.totalTokens,
            costUsd: Number(row.costUsd),
          }
        : null,
  };
};
