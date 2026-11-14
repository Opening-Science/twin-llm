import {
  type CatalogModel,
  findCatalogRow,
  MAX_SELECTED_MODELS,
  MIN_SELECTED_MODELS,
  turnModelName,
} from "@/infrastructure/model-catalog";
import { readableTitle } from "@/infrastructure/readable-title";

import type { PickedModel } from "./conversation";

/**
 * Everything about a new turn that needs no database (SERVER-SPEC 3.1). The
 * turn-starting action and a scheduled run both ask it, so they refuse with
 * the same sentences. Names come only from the catalog: a name the browser
 * sent is never stored.
 */

export const SIGN_IN_SENTENCE = "Sign in to send a prompt to TwinLLM.";
export const EMPTY_PROMPT_SENTENCE = "Write a prompt before sending.";
export const MODEL_COUNT_SENTENCE = `Pick between ${String(MIN_SELECTED_MODELS)} and ${String(MAX_SELECTED_MODELS)} models.`;
export const NO_CATALOG_SENTENCE =
  "We can't reach the model list right now. Try again in a moment.";
export const NOT_FREE_SENTENCE = "One of those models isn't on the free list any more.";
export const NOT_OFFERED_SENTENCE =
  "One of those models isn't available for the active LLM provider.";

const TITLE_MAX = 80;

export type TurnPlanInput = Readonly<{
  prompt: string;
  modelIds: readonly string[];
  skill?: string | null;
  label?: string | null;
}>;

export type TurnPlan = Readonly<{
  prompt: string;
  models: readonly PickedModel[];
  skill: string | null;
  label: string | null;
  title: string;
}>;

export type PlanResult =
  Readonly<{ ok: true; plan: TurnPlan }> | Readonly<{ ok: false; error: string }>;

/** The thread title a turn gives a new thread. */
export const planTitle = (prompt: string, skill: string | null): string =>
  readableTitle(skill === null ? prompt : `/${skill} ${prompt}`).slice(0, TITLE_MAX);

export const planTurn = (
  input: TurnPlanInput,
  catalog: readonly CatalogModel[] | null,
  provider: string,
): PlanResult => {
  const prompt = input.prompt.trim();
  if (prompt === "") return { ok: false, error: EMPTY_PROMPT_SENTENCE };
  const ids = [...new Set(input.modelIds)];
  if (ids.length < MIN_SELECTED_MODELS || ids.length > MAX_SELECTED_MODELS) {
    return { ok: false, error: MODEL_COUNT_SENTENCE };
  }
  if (catalog === null) return { ok: false, error: NO_CATALOG_SENTENCE };
  if (ids.some((id) => findCatalogRow(id, catalog) === null)) {
    return {
      ok: false,
      error: provider === "openrouter" ? NOT_FREE_SENTENCE : NOT_OFFERED_SENTENCE,
    };
  }
  const skill = input.skill ?? null;
  const label = input.label?.trim() ?? "";
  return {
    ok: true,
    plan: {
      prompt,
      models: ids.map((id) => ({
        id,
        name: turnModelName(
          { id, name: findCatalogRow(id, catalog)?.name ?? id },
          catalog,
          prompt,
        ),
      })),
      skill,
      label: label === "" || label === prompt ? null : label,
      title: planTitle(prompt, skill),
    },
  };
};
