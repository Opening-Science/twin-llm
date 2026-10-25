import type { EvidenceAttribution } from "@/infrastructure/oura-types";
import { toResponseDocument } from "@/infrastructure/response-document/parse";

import type { ResponseState } from "./conversation";

/** Prisma `Decimal` or a plain number; both convert with `Number()`. */
type NumericLike = number | Readonly<{ toString: () => string }>;

export type SavedResponseRow = Readonly<{
  id: string;
  modelId: string;
  modelName: string;
  status: ResponseState["status"];
  text: string;
  reasoningText: string | null;
  attribution: unknown;
  responseDocument: unknown;
  timeToFirstTokenMs: number | null;
  tokensPerSecond: NumericLike | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  costUsd: NumericLike;
}>;

/**
 * One saved `model_responses` row as the arena holds it. The stored response
 * document is validated here, the same way the live stream's is.
 *
 * An answer the document withholds (abstained or declined) leaves the server
 * without its text or reasoning: the column only ever shows the banner for it,
 * so the words have no reason to reach the browser.
 */
export const toSavedResponseState = (row: SavedResponseRow): ResponseState => {
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
