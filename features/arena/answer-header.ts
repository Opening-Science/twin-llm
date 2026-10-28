import { autoChoiceLineFor } from "@/infrastructure/agent-router";
import { AUTO_MODEL_ID } from "@/infrastructure/model-catalog";
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
): string | null =>
  answer.modelId === AUTO_MODEL_ID ? autoChoiceLineFor(prompt, answer.modelName) : null;
