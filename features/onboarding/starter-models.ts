import { type CatalogModel, defaultModelSelection } from "@/infrastructure/model-catalog";

/**
 * The rows the first question on /start goes to: the default selection
 * fitted to that question (#493), so a sleep question gets Sleep beside
 * General, as Compare's defaults do in the prompt bar.
 */
export const starterModels = (
  catalog: readonly CatalogModel[],
  question: string,
): readonly Readonly<{ id: string; name: string }>[] =>
  defaultModelSelection(catalog, question).flatMap((id) => {
    const model = catalog.find((candidate) => candidate.id === id);
    return model ? [{ id: model.id, name: model.name }] : [];
  });
