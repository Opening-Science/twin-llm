import { z } from "zod";

import { roundTo } from "./format-measure";

/**
 * Catalog rows and the pure rules about them: parsing each provider's model
 * list, ordering, default picks and display formatting.
 *
 * No I/O lives here, so the browser-side picker and the server-rendered
 * models page share these rules without importing a `server-only` module.
 * The fetching half is `fetch-model-catalog.ts`.
 */

export type CatalogModel = {
  /** The id `POST /api/chat` expects, exactly as the provider lists it. */
  readonly id: string;
  /** Display name, without vendor prefix or "(free)" tag. */
  readonly name: string;
  /** Vendor as it names itself, for display. */
  readonly provider: string;
  /** Stable vendor key, used for grouping. */
  readonly providerId: string;
  readonly contextTokens: number;
  /**
   * Present when the provider reported no context window and `contextTokens`
   * is only a placeholder. Such rows sort after measured ones, in list order.
   */
  readonly contextUnknown?: true;
};

/** Upper and lower bounds on how many models one prompt goes to. */
export const MAX_SELECTED_MODELS = 3;
export const MIN_SELECTED_MODELS = 1;

/** Shown when a provider reports no window. A stand-in, never a measurement. */
const UNKNOWN_WINDOW = 128_000;

const windowOf = (
  reported: number | undefined,
): Pick<CatalogModel, "contextTokens" | "contextUnknown"> =>
  reported === undefined
    ? { contextTokens: UNKNOWN_WINDOW, contextUnknown: true }
    : { contextTokens: reported };

// --- ordering -----------------------------------------------------------------

/** Widest window first; name breaks ties so equal windows never reshuffle. */
const widestFirst = (left: CatalogModel, right: CatalogModel): number => {
  const byWindow = right.contextTokens - left.contextTokens;
  return byWindow !== 0 ? byWindow : left.name.localeCompare(right.name);
};

/**
 * Measured windows first (widest first), then placeholder rows in the order
 * the server returned them; `Array.prototype.sort` is stable.
 */
const measuredThenListed = (left: CatalogModel, right: CatalogModel): number => {
  const leftUnknown = left.contextUnknown === true;
  const rightUnknown = right.contextUnknown === true;
  if (leftUnknown !== rightUnknown) return leftUnknown ? 1 : -1;
  return leftUnknown ? 0 : widestFirst(left, right);
};

// --- parsing --------------------------------------------------------------------

/**
 * Validates the envelope, then each row on its own: a row that does not
 * match is skipped instead of failing the whole list, and unknown fields are
 * ignored so a provider adding one never empties the catalog.
 */
const validRows = <Row>(
  payload: unknown,
  listKey: "data" | "models",
  row: z.ZodType<Row>,
): Row[] | null => {
  const envelope = z.object({ [listKey]: z.array(z.unknown()) }).safeParse(payload);
  if (!envelope.success) return null;
  const items = envelope.data[listKey] ?? [];
  return items.flatMap((item) => {
    const parsed = row.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
};

const idOnly = z.object({ id: z.string().min(1) });

/** Infomaniak's OpenAI-style `GET /models`. No windows are reported. */
export const parseInfomaniakModels = (
  payload: unknown,
): readonly CatalogModel[] | null => {
  const rows = validRows(payload, "data", idOnly);
  if (rows === null || rows.length === 0) return null;
  return rows
    .map(({ id }): CatalogModel => ({
      id,
      name: id,
      provider: "Infomaniak",
      providerId: "infomaniak",
      ...windowOf(undefined),
    }))
    .sort(measuredThenListed);
};

const ollamaTag = z.object({
  name: z.string().min(1),
  capabilities: z.array(z.string()).optional(),
  details: z
    .object({ context_length: z.number().int().positive().optional() })
    .optional(),
});

/**
 * Embedding models cannot chat. Newer Ollama versions list capabilities;
 * for older ones the name is the only hint.
 */
const canChat = ({ name, capabilities }: z.infer<typeof ollamaTag>): boolean =>
  capabilities === undefined ? !/embed/i.test(name) : capabilities.includes("completion");

/**
 * Ollama `GET /api/tags`. The tag stays in the id (`qwen3:8b`) because Ollama
 * resolves a bare name only to `:latest`; that one suffix is dropped.
 */
export const parseOllamaTags = (payload: unknown): readonly CatalogModel[] | null => {
  const tags = validRows(payload, "models", ollamaTag);
  if (tags === null) return null;
  return tags
    .filter(canChat)
    .map((tag): CatalogModel => {
      const id = tag.name.endsWith(":latest")
        ? tag.name.slice(0, -":latest".length)
        : tag.name;
      return {
        id,
        name: id,
        provider: "Ollama",
        providerId: "ollama",
        ...windowOf(tag.details?.context_length),
      };
    })
    .sort(measuredThenListed);
};

/** Display label for a vLLM server reached through an SSH tunnel. */
export const REMOTE_GPU_PROVIDER_LABEL = "Remote GPU (SSH tunnel)";

/** Display label for our own vLLM servers on Exoscale. */
export const EXOSCALE_PROVIDER_LABEL = "Exoscale (Switzerland)";

/** Providers whose models come from vLLM `/v1/models`. */
export type VllmProviderId = "exoscale" | "remote-gpu";

/** Which vLLM deployment a row belongs to. */
export type VllmSource = Readonly<{ provider: string; providerId: VllmProviderId }>;

export const REMOTE_GPU_SOURCE: VllmSource = Object.freeze({
  providerId: "remote-gpu",
  provider: REMOTE_GPU_PROVIDER_LABEL,
});

export const EXOSCALE_SOURCE: VllmSource = Object.freeze({
  providerId: "exoscale",
  provider: EXOSCALE_PROVIDER_LABEL,
});

const vllmModel = idOnly.extend({
  max_model_len: z.number().int().positive().optional(),
});

/**
 * vLLM `GET /v1/models`. The id is the served model name; `max_model_len` is
 * the window the server was started with, which may be below the model's own.
 */
export const parseVllmModels = (
  payload: unknown,
  source: VllmSource = REMOTE_GPU_SOURCE,
): readonly CatalogModel[] | null =>
  validRows(payload, "data", vllmModel)
    ?.map((row): CatalogModel => ({
      id: row.id,
      name: row.id,
      ...source,
      ...windowOf(row.max_model_len),
    }))
    .sort(measuredThenListed) ?? null;

const openRouterModel = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  context_length: z.number().int().positive(),
  pricing: z.object({ prompt: z.string(), completion: z.string() }),
});

/**
 * OpenRouter names look like "Vendor: Model (free)". Without a vendor prefix,
 * the id's namespace is used as-is rather than inventing a vendor name.
 */
const displayParts = (
  label: string,
  namespace: string,
): Pick<CatalogModel, "name" | "provider"> => {
  const bare = label.replace(/\s*\(free\)\s*$/i, "").trim();
  const [vendor, ...rest] = bare.split(": ");
  return rest.length === 0
    ? { name: bare, provider: namespace }
    : { name: rest.join(": ").trim(), provider: (vendor ?? namespace).trim() };
};

/**
 * OpenRouter `GET /models`, reduced to models that cost nothing. Both signals
 * must agree: a `:free` id and a zero price for prompt and completion. The chat
 * route refuses anything not on this list, so this filter is what keeps a
 * crafted request from running a paid model.
 */
export const parseFreeModels = (payload: unknown): readonly CatalogModel[] | null =>
  validRows(payload, "data", openRouterModel)
    ?.filter(
      ({ id, pricing }) =>
        id.endsWith(":free") &&
        Number(pricing.prompt) === 0 &&
        Number(pricing.completion) === 0,
    )
    .map((model): CatalogModel => {
      const namespace = model.id.split("/", 1)[0] ?? model.id;
      return {
        id: model.id,
        providerId: namespace,
        contextTokens: model.context_length,
        ...displayParts(model.name, namespace),
      };
    })
    .sort(widestFirst) ?? null;

// --- selection and display ------------------------------------------------------

/**
 * The models a new prompt starts with: walk the (already ordered) list and
 * take the first model of each vendor, so the opening comparison spans
 * vendors instead of three variants of one; top up from the rest when there
 * are fewer vendors than slots.
 */
export const defaultModelSelection = (
  models: readonly CatalogModel[],
): readonly string[] => {
  const seenVendors = new Set<string>();
  const [firsts, others] = models.reduce<[CatalogModel[], CatalogModel[]]>(
    ([leading, trailing], model) => {
      const isFirst = !seenVendors.has(model.providerId);
      seenVendors.add(model.providerId);
      return isFirst ? [[...leading, model], trailing] : [leading, [...trailing, model]];
    },
    [[], []],
  );
  return [...firsts, ...others].slice(0, MAX_SELECTED_MODELS).map(({ id }) => id);
};

/**
 * "262K", "1M": decimal thousands and millions, because 1,000,000 / 1024
 * would print the largest window as "977K".
 */
export const formatContextWindow = (tokens: number): string => {
  const millions = tokens >= 1_000_000;
  const scaled = millions ? roundTo(tokens / 1_000_000, 1) : roundTo(tokens / 1_000, 0);
  return `${String(scaled)}${millions ? "M" : "K"}`;
};

/** A model's window as shown to people: "unknown" when the provider sent none. */
export const formatModelWindow = (
  model: Pick<CatalogModel, "contextTokens" | "contextUnknown">,
): string =>
  model.contextUnknown ? "unknown" : formatContextWindow(model.contextTokens);
