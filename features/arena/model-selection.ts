import {
  AUTO_MODEL_ID,
  type CatalogModel,
  findCatalogRow,
  MAX_SELECTED_MODELS,
  MIN_SELECTED_MODELS,
} from "@/infrastructure/model-catalog";
import { friendlyModelName } from "@/infrastructure/model-names";

/**
 * The 1-to-3 model rule as plain functions, so the prompt bar and the menu
 * cannot disagree about it and the edges are tested without a browser.
 *
 * A thread remembers the models it last used, and the catalog can lose one
 * between visits. Ids the catalog no longer lists are dropped silently here;
 * `missingCount` is what lets the prompt bar say so in words.
 */

/**
 * The models a prompt may go to: the whole catalog, or in an incognito chat
 * only those that run on this machine.
 */
export const offeredModels = (
  catalog: readonly CatalogModel[],
  incognito: boolean,
  localModelIds: readonly string[],
): readonly CatalogModel[] =>
  incognito ? catalog.filter((model) => localModelIds.includes(model.id)) : catalog;

/** The line under an incognito prompt bar. */
export const incognitoHint = (localCount: number): string =>
  localCount === 0
    ? "No model on this machine is offered, so an incognito chat has nowhere to go. Turn incognito off to use the others."
    : "Local models only. Nothing in this chat is saved; a reload or a new chat discards it.";

/** The chosen models in catalog order, ignoring ids the catalog does not have. */
export const chosenModels = (
  catalog: readonly CatalogModel[],
  ids: readonly string[],
): CatalogModel[] => catalog.filter((model) => ids.includes(model.id));

export const missingCount = (
  catalog: readonly CatalogModel[] | null,
  ids: readonly string[],
): number =>
  catalog ? ids.filter((id) => findCatalogRow(id, catalog) === null).length : 0;

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

export type MenuGroup = Readonly<{
  label: "Agents" | "Models";
  models: readonly CatalogModel[];
}>;

/** The menu's sections: agents first, then models; an empty one is left out. */
export const menuGroups = (catalog: readonly CatalogModel[]): readonly MenuGroup[] =>
  (
    [
      { label: "Agents", models: catalog.filter((model) => model.agent !== undefined) },
      { label: "Models", models: catalog.filter((model) => model.agent === undefined) },
    ] as const
  ).filter((group) => group.models.length > 0);

/** What Auto's row says under its name: it runs as another agent each time. */
export const AUTO_SUBLINE = "Picks an agent for each question";

/**
 * The small line under a row's name: Auto's own line, an agent's base model,
 * a fine-tune's raw id (its name is the readable one), else the provider.
 */
export const menuSubline = (
  model: Pick<CatalogModel, "id" | "provider" | "agent">,
): string => {
  if (model.id === AUTO_MODEL_ID) return AUTO_SUBLINE;
  if (model.agent) return model.agent.baseModelName;
  return friendlyModelName(model.id) === null ? model.provider : model.id;
};
