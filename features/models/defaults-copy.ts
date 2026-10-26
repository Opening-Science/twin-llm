import type { CatalogModel } from "@/infrastructure/model-catalog";
import { formatNumber } from "@/infrastructure/format-measure";

/**
 * The Models screen's sentence about the picks a new round opens with, counted
 * from the picks themselves rather than from the maximum. With Ollama or
 * the remote GPU there can be fewer than three models and only one vendor, and
 * the old fixed "3 … from three different vendors" was then untrue.
 */
export const defaultsCopy = (
  catalog: readonly CatalogModel[],
  defaultSelection: readonly string[],
): string => {
  const picks = catalog.filter((model) => defaultSelection.includes(model.id));
  const count = picks.length;
  if (count === 0) return "";
  if (count === 1) return "The model marked default opens a new round.";

  const vendors = new Set(picks.map((model) => model.providerId)).size;
  const lead = `The ${formatNumber(count, 0)} marked default open a new round:`;

  if (vendors === count)
    return `${lead} the widest window from each of ${formatNumber(vendors, 0)} different vendors.`;
  if (vendors === 1) return `${lead} the first ${formatNumber(count, 0)} on the list.`;
  return `${lead} the top model from each of ${formatNumber(vendors, 0)} vendors, then the next on the list.`;
};

export type CatalogOrder = "window" | "mixed" | "server";

/**
 * How the list is ordered, from what the provider reported: by window
 * when every row has one, real windows then the rest when some do, and the
 * provider's own order when none do (Infomaniak's 128K is a placeholder).
 */
export const catalogOrder = (catalog: readonly CatalogModel[]): CatalogOrder => {
  const known = catalog.filter((model) => !model.contextUnknown).length;
  if (known === 0) return "server";
  return known === catalog.length ? "window" : "mixed";
};

export const ORDER_COPY: Readonly<
  Record<CatalogOrder, { lead: string; caption: string }>
> = {
  window: {
    lead: "Every model the active provider can reach, largest context window first.",
    caption: "Models available in TwinLLM, sorted by context window, largest first.",
  },
  mixed: {
    lead: "Every model the active provider can reach, largest reported context window first, then those that report none.",
    caption:
      "Models available in TwinLLM, sorted by reported context window, largest first, then those that report none in the provider's order.",
  },
  server: {
    lead: "Every model the active provider can reach, in the order it lists them.",
    caption: "Models available in TwinLLM, in the order the provider lists them.",
  },
};
