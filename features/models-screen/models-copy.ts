import { formatNumber } from "@/infrastructure/format-measure";
import { type CatalogModel, formatContextWindow } from "@/infrastructure/model-catalog";

/**
 * The words of the models page (`/models`), from the list itself: how it is
 * ordered, what calls cost, which models a new chat starts with and the
 * one-line summary. Pure.
 */

export type ModelsOrder = "window" | "window-then-unknown" | "provider";

/** All rows report a window, some do, or none do. */
export const modelsOrder = (models: readonly CatalogModel[]): ModelsOrder => {
  const unknown = models.filter((model) => model.contextUnknown).length;
  if (unknown === 0) return "window";
  return unknown === models.length ? "provider" : "window-then-unknown";
};

const ORDER_PHRASE: Readonly<Record<ModelsOrder, string>> = {
  window: "largest context window first",
  "window-then-unknown":
    "largest reported context window first, then the models that report none",
  provider: "in the order the provider lists them",
};

export const orderLead = (order: ModelsOrder): string =>
  `Every model the active provider can reach, ${ORDER_PHRASE[order]}.`;

/** The table's caption for screen readers, matching the order lead. */
export const tableCaption = (order: ModelsOrder): string =>
  `Models available in TwinLLM, ${ORDER_PHRASE[order]}.`;

/** The same on every install: which providers exist and where each may be used. */
export const PROVIDER_SENTENCE =
  "If TwinLLM runs only on this machine, Ollama is the only provider; otherwise the default is our own open models on Exoscale in Switzerland, and OpenRouter and the remote GPU are only offered on synthetic data with no wearable snapshot loaded.";

/** What a call costs, by provider; null where there is nothing to say. */
export const costSentence = (provider: string): string | null => {
  switch (provider) {
    case "ollama":
    case "openrouter":
      return "Every call to a listed model is free.";
    case "remote-gpu":
      return "Calls carry no charge of their own, but the GPU pod is billed by the hour while it runs.";
    case "exoscale":
      return "Calls carry no charge of their own, but the Exoscale GPU instance is billed by the hour while it runs.";
    default:
      return null;
  }
};

/** Known per-call cost: zero for local and free models, unknown elsewhere. */
export const perCallKnown = (provider: string): boolean =>
  provider === "ollama" || provider === "openrouter";

export const PER_CALL_ZERO = "$0.0000";

const COUNT_WORDS = ["zero", "one", "two", "three", "four", "five"];
const countWord = (count: number): string => COUNT_WORDS[count] ?? formatNumber(count, 0);

/** Which models a new chat starts with and why, counted from the actual picks. */
export const defaultsSentence = (
  models: readonly CatalogModel[],
  picks: readonly string[],
): string | null => {
  const picked = models.filter((model) => picks.includes(model.id));
  const count = picked.length;
  if (count === 0) return null;
  if (count === 1) return "The model marked default opens a new round.";
  const vendors = new Set(picked.map((model) => model.providerId)).size;
  const n = countWord(count);
  if (vendors === count) {
    return `The ${n} marked default are the widest window from each of ${n} vendors.`;
  }
  if (vendors === 1) return `The ${n} marked default are the first ${n} on the list.`;
  return `The ${n} marked default are the top model from each of ${countWord(vendors)} vendors, then the next on the list.`;
};

/** The widest reported window, or null when no row reports one. */
export const widestWindow = (models: readonly CatalogModel[]): number | null =>
  models.reduce<number | null>(
    (widest, model) =>
      model.contextUnknown ? widest : Math.max(widest ?? 0, model.contextTokens),
    null,
  );

/** The summary's parts, drawn with decorative dots between: "4 models", "128K widest window", "$0.0000 each". */
export const summaryParts = (
  models: readonly CatalogModel[],
  provider: string,
): readonly string[] => {
  const widest = widestWindow(models);
  return [
    `${formatNumber(models.length, 0)} ${models.length === 1 ? "model" : "models"}`,
    ...(widest === null ? [] : [`${formatContextWindow(widest)} widest window`]),
    ...(perCallKnown(provider) ? [`${PER_CALL_ZERO} each`] : []),
  ];
};

/** The bar's length: the window as a share of the widest, 0 to 100. */
export const windowShare = (tokens: number, widest: number | null): number =>
  widest === null || widest <= 0 ? 0 : Math.round((tokens / widest) * 1000) / 10;

export const UNAVAILABLE_SENTENCE =
  "The model provider did not send its model list just now, so there is nothing to show here. The rest of TwinLLM still works.";

/** The built-in list shown when Ollama or Infomaniak could not be asked. */
export const OFFLINE_SENTENCE =
  "Offline: the provider could not be reached, so this is TwinLLM's built-in list, not what the provider serves right now.";
