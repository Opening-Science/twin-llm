import { autoChoiceLineFor } from "@/infrastructure/agent-router";
import { AGENT_ID_PREFIX } from "@/infrastructure/agents";
import { effortLine } from "@/infrastructure/chat-effort";
import { AUTO_MODEL_ID, type CatalogModel } from "@/infrastructure/model-catalog";
import { friendlyModelName } from "@/infrastructure/model-names";
import type { ResponseDocumentV1 } from "@/infrastructure/response-document/document-v1";
import type { StatusTone } from "@/infrastructure/ui-kit/status-badge";
import type { StepState, TraceState } from "@/infrastructure/ui-kit/step-trace-model";

import type { AnswerState, ToolCard } from "./conversation";
import { cardOutcome } from "./tool-cards";

/**
 * The words of a column's header (SPEC 4). Pure.
 */

/** The badge's letter: the first letter or digit of the display name. */
export const badgeLetter = (name: string): string =>
  (/[\p{L}\p{N}]/u.exec(name)?.[0] ?? "?").toUpperCase();

/** The raw model id under the name, only for a fine-tune with a friendly name. */
export const fineTuneId = (modelId: string): string | null =>
  friendlyModelName(modelId) === null ? null : modelId;

/**
 * Which specialist Auto chose, on which model, and why; null for any other
 * answer. The model is Auto's own base model when the catalog says, else the
 * specialist's; it is left out when the catalog no longer offers the
 * specialist.
 */
export const autoLine = (
  answer: Readonly<{ modelId: string; modelName: string }>,
  prompt: string,
  catalog: readonly CatalogModel[] | null,
): string | null => {
  if (answer.modelId !== AUTO_MODEL_ID) return null;
  const modelNameOf = (agentId: string): string | null => {
    if (catalog === null) return null;
    const specialist = catalog.find((row) => row.id === `${AGENT_ID_PREFIX}${agentId}`);
    if (specialist === undefined) return null;
    const auto = catalog.find((row) => row.id === AUTO_MODEL_ID)?.agent;
    return auto?.baseModelName ?? specialist.agent?.baseModelName ?? null;
  };
  return autoChoiceLineFor(prompt, answer.modelName, modelNameOf);
};

/** A card's state as a step of the trace: no data is a step that ran and found nothing. */
export const stepStateOf = (card: Pick<ToolCard, "state" | "didNotRun">): StepState =>
  card.state === "running"
    ? "current"
    : card.state === "error"
      ? "failed"
      : card.state === "refused"
        ? card.didNotRun === true
          ? "refused"
          : "skipped"
        : "done";

/** The trace works while the answer streams or its number check runs, then settles. */
export const traceStateOf = (
  answer: Pick<AnswerState, "status" | "reviewing">,
): TraceState =>
  answer.status === "STREAMING" || answer.reviewing === true
    ? "working"
    : answer.status === "COMPLETE"
      ? "done"
      : "failed";

const BADGE_TONES: Readonly<Record<ReturnType<typeof cardOutcome>, StatusTone>> = {
  Running: "neutral",
  Done: "ok",
  "No data": "off",
  Refused: "off",
  Failed: "warn",
};

/** A card's badge: its outcome in words and the tone that goes with it. */
export const cardBadge = (
  card: Pick<ToolCard, "state" | "didNotRun">,
): Readonly<{ label: ReturnType<typeof cardOutcome>; tone: StatusTone }> => {
  const label = cardOutcome(card);
  return { label, tone: BADGE_TONES[label] };
};

/** The effort line, only when the answer ran at an effort other than Balanced. */
export const answerEffortLine = (
  document: Pick<ResponseDocumentV1, "effort"> | null | undefined,
): string | null => {
  const effort = document?.effort;
  if (effort === undefined || effort.level === "balanced") return null;
  return effortLine({
    level: effort.level,
    thinking: effort.thinking,
    maxSteps: effort.max_steps,
    review: effort.review,
  });
};
