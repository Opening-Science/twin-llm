import type { ModelResponseMetrics } from "@/infrastructure/model-response-metrics";
import type { StoredToolPart } from "@/infrastructure/model-response-tool-parts";
import type { EvidenceAttribution } from "@/infrastructure/oura-types";
import type { ResponseDocumentV1 } from "@/infrastructure/response-document/document-v1";

import { storedToolParts, type ToolResultLike } from "./tool-parts";

/**
 * The two terminal writes for a `ModelResponse` row that `startTurn` created
 * as STREAMING: COMPLETE with the answer and its measured numbers, or FAILED.
 *
 * The numbers stored are the same measured values the browser received in
 * the stream's metadata, so the card and the leaderboard can never disagree.
 * Prisma is reached through a one-method port so tests pass a fake.
 */
export type ModelResponseCompleteParams = Readonly<{
  turnId: string;
  modelId: string;
  text: string;
  metrics: ModelResponseMetrics;
  reasoningText?: string | null;
  attribution?: readonly EvidenceAttribution[];
  document?: ResponseDocumentV1 | null;
  /** The turn's tool results; left out, the column is not touched. */
  toolResults?: readonly ToolResultLike[];
}>;

type RowKey = Readonly<{ turnId_modelId: { turnId: string; modelId: string } }>;

type MetricColumns = Pick<
  ModelResponseMetrics,
  | "timeToFirstTokenMs"
  | "tokensPerSecond"
  | "inputTokens"
  | "outputTokens"
  | "totalTokens"
>;

export type ModelResponseCompleteUpdate = Readonly<{
  where: RowKey;
  data: MetricColumns & {
    text: string;
    status: "COMPLETE";
    reasoningText: string | null;
    attribution: EvidenceAttribution[] | undefined;
    /** Undefined leaves the column as it is. */
    responseDocument: ResponseDocumentV1 | undefined;
    /** Null when the answer used no tool. */
    toolParts: StoredToolPart[] | null | undefined;
    completedAt: Date;
  };
}>;

export type ModelResponseFailedUpdate = Readonly<{
  where: RowKey;
  data: { status: "FAILED"; completedAt: Date };
}>;

export type ModelResponseWritePort = Readonly<{
  update: (args: ModelResponseCompleteUpdate) => Promise<unknown>;
}>;

export type ModelResponseFailPort = Readonly<{
  update: (args: ModelResponseFailedUpdate) => Promise<unknown>;
}>;

const rowKey = (turnId: string, modelId: string): RowKey => ({
  turnId_modelId: { turnId, modelId },
});

const metricColumns = (metrics: ModelResponseMetrics): MetricColumns => {
  const { timeToFirstTokenMs, tokensPerSecond, inputTokens, outputTokens, totalTokens } =
    metrics;
  return { timeToFirstTokenMs, tokensPerSecond, inputTokens, outputTokens, totalTokens };
};

export const writeModelResponseComplete = async (
  port: ModelResponseWritePort,
  params: ModelResponseCompleteParams,
  now: () => Date = () => new Date(),
): Promise<void> => {
  const { turnId, modelId, text, metrics, reasoningText, attribution, document } = params;
  const completedAt = now();
  await port.update({
    where: rowKey(turnId, modelId),
    data: {
      ...metricColumns(metrics),
      text,
      status: "COMPLETE",
      reasoningText: reasoningText ?? null,
      attribution: attribution === undefined ? undefined : Array.from(attribution),
      responseDocument: document ?? undefined,
      toolParts:
        params.toolResults === undefined
          ? undefined
          : storedToolParts(
              params.toolResults,
              document?.data_basis.tool_calls ?? [],
              completedAt,
            ),
      completedAt,
    },
  });
};

export const writeModelResponseFailed = async (
  port: ModelResponseFailPort,
  target: Readonly<{ turnId: string; modelId: string }>,
  now: () => Date = () => new Date(),
): Promise<void> => {
  await port.update({
    where: rowKey(target.turnId, target.modelId),
    data: { status: "FAILED", completedAt: now() },
  });
};
