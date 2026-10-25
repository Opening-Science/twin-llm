import {
  type CatalogModel,
  MAX_SELECTED_MODELS,
  MIN_SELECTED_MODELS,
} from "@/infrastructure/model-catalog";

/**
 * The 1-to-3 model rule as plain functions, so the prompt bar and the menu
 * cannot disagree about it and the edges are tested without a browser.
 *
 * A thread remembers the models it last used, and the catalog can lose one
 * between visits. Ids the catalog no longer lists are dropped silently here;
 * `missingCount` is what lets the prompt bar say so in words.
 */

/** The chosen models in catalog order, ignoring ids the catalog does not have. */
export const chosenModels = (
  catalog: readonly CatalogModel[],
  ids: readonly string[],
): CatalogModel[] => catalog.filter((model) => ids.includes(model.id));

export const missingCount = (
  catalog: readonly CatalogModel[] | null,
  ids: readonly string[],
): number =>
  catalog ? ids.filter((id) => !catalog.some((model) => model.id === id)).length : 0;

export type ToggleLimit = "floor" | "cap" | null;

/** Why a model cannot be switched right now, if it cannot. */
export const toggleLimit = (selected: boolean, count: number): ToggleLimit => {
  if (selected && count <= MIN_SELECTED_MODELS) return "floor";
  if (!selected && count >= MAX_SELECTED_MODELS) return "cap";
  return null;
};

/** Adds or removes one model, unless that would leave the 1-to-3 range. */
export const toggleModel = (
  catalog: readonly CatalogModel[],
  ids: readonly string[],
  modelId: string,
): string[] => {
  const current = chosenModels(catalog, ids).map((model) => model.id);
  const selected = current.includes(modelId);
  if (toggleLimit(selected, current.length) !== null) return current;
  return selected ? current.filter((id) => id !== modelId) : [...current, modelId];
};
