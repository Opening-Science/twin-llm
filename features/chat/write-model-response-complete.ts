import type { ModelResponseMetrics } from "@/infrastructure/model-response-metrics";
import type { StoredToolPart } from "@/infrastructure/model-response-tool-parts";
import type { EvidenceAttribution } from "@/infrastructure/oura-types";
import type { ResponseDocumentV1 } from "@/infrastructure/response-document/document-v1";

import { storedToolParts, type ToolResultLike } from "./tool-parts";

/**
 * The terminal writes for a `ModelResponse` row that `startTurn` created as
 * STREAMING: COMPLETE with the answer and its measured numbers, FAILED,
 * REFUSED with TwinLLM's own refusal sentence when no model was called, or
 * STOPPED with what the model had written when the person pressed Stop (#373).
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

/** A stopped answer has no metrics: the model never reported its usage. */
export type ModelResponseStoppedParams = Omit<ModelResponseCompleteParams, "metrics">;

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

export type ModelResponseRefusedUpdate = Readonly<{
  where: RowKey;
  data: { status: "REFUSED"; text: string; completedAt: Date };
}>;

export type ModelResponseStoppedUpdate = Readonly<{
  where: RowKey;
  data: Omit<
    ModelResponseCompleteUpdate["data"],
    keyof MetricColumns | "status"
  > & { status: "STOPPED" };
}>;

export type ModelResponseWritePort = Readonly<{
  update: (args: ModelResponseCompleteUpdate) => Promise<unknown>;
}>;

export type ModelResponseFailPort = Readonly<{
  update: (args: ModelResponseFailedUpdate) => Promise<unknown>;
}>;

export type ModelResponseRefusePort = Readonly<{
  update: (args: ModelResponseRefusedUpdate) => Promise<unknown>;
}>;

export type ModelResponseStopPort = Readonly<{
  update: (args: ModelResponseStoppedUpdate) => Promise<unknown>;
}>;

const rowKey = (turnId: string, modelId: string): RowKey => ({
  turnId_modelId: { turnId, modelId },
});

const metricColumns = (metrics: ModelResponseMetrics): MetricColumns => {
  const { timeToFirstTokenMs, tokensPerSecond, inputTokens, outputTokens, totalTokens } =
    metrics;
  return { timeToFirstTokenMs, tokensPerSecond, inputTokens, outputTokens, totalTokens };
};

/** The answer's columns, the same for a finished answer and a stopped one. */
const answerColumns = (params: ModelResponseStoppedParams, completedAt: Date) => ({
  text: params.text,
  reasoningText: params.reasoningText ?? null,
  attribution:
    params.attribution === undefined ? undefined : Array.from(params.attribution),
  responseDocument: params.document ?? undefined,
  toolParts:
    params.toolResults === undefined
      ? undefined
      : storedToolParts(
          params.toolResults,
          params.document?.data_basis.tool_calls ?? [],
          completedAt,
        ),
  completedAt,
});

export const writeModelResponseComplete = async (
  port: ModelResponseWritePort,
  params: ModelResponseCompleteParams,
  now: () => Date = () => new Date(),
): Promise<void> => {
  await port.update({
    where: rowKey(params.turnId, params.modelId),
    data: {
      ...metricColumns(params.metrics),
      ...answerColumns(params, now()),
      status: "COMPLETE",
    },
  });
};

export const writeModelResponseStopped = async (
  port: ModelResponseStopPort,
  params: ModelResponseStoppedParams,
  now: () => Date = () => new Date(),
): Promise<void> => {
  await port.update({
    where: rowKey(params.turnId, params.modelId),
    data: { ...answerColumns(params, now()), status: "STOPPED" },
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

/**
 * Stores a refusal on the row so a reload shows it instead of asking again.
 * `sentence` must be one TwinLLM wrote (a policy or skill refusal), never a
 * provider or exception message.
 */
export const writeModelResponseRefused = async (
  port: ModelResponseRefusePort,
  target: Readonly<{ turnId: string; modelId: string; sentence: string }>,
  now: () => Date = () => new Date(),
): Promise<void> => {
  await port.update({
    where: rowKey(target.turnId, target.modelId),
    data: { status: "REFUSED", text: target.sentence, completedAt: now() },
  });
};
