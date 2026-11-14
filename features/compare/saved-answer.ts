import { viewsOf } from "@/infrastructure/chat-view";
import { profileFrameOf } from "@/infrastructure/gbd-profile-frame";
import type { ModelResponseMetrics } from "@/infrastructure/model-response-metrics";
import { toStoredToolParts } from "@/infrastructure/model-response-tool-parts";
import { numberSources } from "@/infrastructure/number-sources";
import type { EvidenceAttribution } from "@/infrastructure/oura-types";
import { toResponseDocument } from "@/infrastructure/response-document/parse";
import { isWearableSourceId } from "@/infrastructure/wearable-provenance";

import { isWithheld } from "./answer-text";
import type { AnswerState } from "./conversation";
import { storedAsLiveParts, storedToolCards } from "./tool-cards";

/**
 * A stored answer row as the view's answer state (SERVER-SPEC 3.6, SPEC
 * 8.5): what may leave the server. A withheld answer's words, views and
 * number links stay here; tool outputs stay here except the views
 * themselves and a population profile's frame; number sources say which
 * call and row hold a number, never the value read.
 */

export type StoredAnswerRow = Readonly<{
  id: string;
  modelId: string;
  modelName: string;
  status: "STREAMING" | "COMPLETE" | "FAILED" | "REFUSED" | "STOPPED";
  /** Opened columns: text as text, JSON columns as parsed values. */
  text: string;
  reasoningText: string | null;
  attribution: unknown;
  responseDocument: unknown;
  toolParts: unknown;
  timeToFirstTokenMs: number | null;
  tokensPerSecond: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  costUsd: number;
  completedAt: Date | null;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Stored attribution items, each checked: the column is JSON, not trusted. */
export const toAttribution = (value: unknown): EvidenceAttribution[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): EvidenceAttribution[] => {
    if (!isRecord(item)) return [];
    const { metricKey, label, value: stated } = item;
    if (typeof metricKey !== "string" || typeof label !== "string") return [];
    if (typeof stated !== "string" && typeof stated !== "number") return [];
    const { source, ...rest } = item;
    return [
      {
        ...(rest as Omit<EvidenceAttribution, "source">),
        metricKey,
        label,
        value: stated,
        ...(isWearableSourceId(source) ? { source } : {}),
      },
    ];
  });
};

const metricsOf = (row: StoredAnswerRow): ModelResponseMetrics => ({
  modelId: row.modelId,
  timeToFirstTokenMs: row.timeToFirstTokenMs,
  tokensPerSecond: row.tokensPerSecond,
  inputTokens: row.inputTokens,
  outputTokens: row.outputTokens,
  totalTokens: row.totalTokens,
  costUsd: row.costUsd,
});

export const savedAnswer = (row: StoredAnswerRow): AnswerState => {
  const base = { id: row.id, modelId: row.modelId, modelName: row.modelName };
  const completedAt = row.completedAt?.toISOString() ?? null;
  if (row.status === "REFUSED") {
    return {
      ...base,
      status: "FAILED",
      text: "",
      refusal: row.text,
      metrics: null,
      completedAt,
    };
  }
  if (row.status === "STREAMING") {
    return { ...base, status: "STREAMING", text: "", metrics: null };
  }
  const document = toResponseDocument(row.responseDocument);
  const withheld = isWithheld(document);
  const stored = toStoredToolParts(row.toolParts) ?? [];
  const parts = storedAsLiveParts(stored);
  const text = withheld ? "" : row.text;
  const complete = row.status === "COMPLETE";
  const frame = withheld ? null : profileFrameOf(parts);
  return {
    ...base,
    status: complete ? "COMPLETE" : "FAILED",
    ...(row.status === "STOPPED" ? { stopped: true } : {}),
    text,
    reasoningText: withheld ? null : row.reasoningText,
    attribution: toAttribution(row.attribution),
    document,
    completedAt,
    tools: storedToolCards(stored),
    views: withheld ? [] : viewsOf(parts),
    ...(frame === null ? {} : { profileFrame: frame }),
    numberSources: complete && !withheld ? numberSources(text, parts) : [],
    metrics: complete ? metricsOf(row) : null,
  };
};
