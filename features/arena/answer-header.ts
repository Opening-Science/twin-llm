import { autoChoiceLineFor } from "@/infrastructure/agent-router";
import { AGENT_ID_PREFIX } from "@/infrastructure/agents";
import { DEFAULT_EFFORT, effortLine } from "@/infrastructure/chat-effort";
import { AUTO_MODEL_ID, type CatalogAgent } from "@/infrastructure/model-catalog";
import { friendlyModelName } from "@/infrastructure/model-names";

/**
 * The two small lines an answer column may carry under its name, kept pure so
 * the column only lays them out.
 */

/** A fine-tune's raw id, shown under its readable name; null for any other model. */
export const columnRawId = (modelId: string): string | null =>
  friendlyModelName(modelId) === null ? null : modelId;

/**
 * Why Auto ran as the agent its column names (#219): "Auto chose Diet
 * specialist: the question is about body weight." Null for any other column.
 */
export const autoLineOf = (
  answer: Readonly<{ modelId: string; modelName: string }>,
  prompt: string,
  modelNameOf: (agentId: string) => string | null = () => null,
): string | null =>
  answer.modelId === AUTO_MODEL_ID
    ? autoChoiceLineFor(prompt, answer.modelName, modelNameOf)
    : null;

/**
 * The model Auto runs a specialist on in this catalog, for the Auto line
 * (#366): Auto's own base model (#379). Null when the catalog does not offer
 * the specialist (a reload after it changed).
 */
export const specialistModelIn =
  (catalog: readonly Readonly<{ id: string; agent?: CatalogAgent }>[] | null) =>
  (agentId: string): string | null => {
    const specialist = catalog?.find(
      (row) => row.id === `${AGENT_ID_PREFIX}${agentId}`,
    )?.agent;
    if (specialist === undefined) return null;
    const auto = catalog?.find((row) => row.id === AUTO_MODEL_ID)?.agent;
    return (auto ?? specialist).baseModelName;
  };

/**
 * The line that names an answer's effort (#366), from its response document.
 * Balanced, the default, and answers from before effort say nothing.
 */
export const effortLineOf = (
  document:
    | Readonly<{
        effort?: Readonly<{
          level: Parameters<typeof effortLine>[0]["level"];
          thinking: Parameters<typeof effortLine>[0]["thinking"];
          max_steps: number;
          review: boolean;
        }>;
      }>
    | null
    | undefined,
): string | null => {
  const effort = document?.effort;
  if (effort === undefined || effort.level === DEFAULT_EFFORT) return null;
  return effortLine({
    level: effort.level,
    thinking: effort.thinking,
    maxSteps: effort.max_steps,
    review: effort.review,
  });
};

/** What a stopped answer says (#366). */
export const STOPPED_COPY = {
  title: "You stopped this answer",
  body: "In a saved thread the server still finishes it and keeps it, so reloading the thread shows it. You can also ask this model again.",
} as const;
