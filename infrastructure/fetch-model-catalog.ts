import "server-only";

import {
  DEFAULT_OLLAMA_BASE_URL,
  exoscaleEnv,
  infomaniakOpenAiBaseUrl,
  remoteGpuEnv,
  serverEnv,
} from "./env";
import { chatModelIsLocal } from "./genome-gate";
import type { AgentOffer } from "./agents";
import { listRemoteGpuModels } from "./list-remote-gpu-models";
import {
  EXOSCALE_SOURCE,
  type CatalogModel as Row,
  parseFreeModels,
  parseInfomaniakModels,
  parseOllamaTags,
  REMOTE_GPU_SOURCE,
  type VllmProviderId,
  type VllmSource,
  withAgents,
} from "./model-catalog";

/**
 * Fetches the model list for the configured LLM_PROVIDER. The parsing rules
 * live in `model-catalog.ts`; this half does the network calls, caching and
 * fallbacks.
 *
 * - openrouter: the public catalog, free models only, cached for an hour.
 * - ollama: local tags; a small static list when the daemon cannot be asked.
 * - infomaniak (legacy): fetched once per process; a static list otherwise.
 * - exoscale / remote-gpu: every vLLM URL is asked on every call, with no
 *   static fallback, because a model nobody is serving must not be offered.
 *
 * Failures are logged by status or error name only; response bodies and
 * error objects can carry tokens, hosts or echoed input.
 */

type Catalog = readonly Row[];

const placeholderRow = (
  providerId: "ollama" | "infomaniak",
  id: string,
  name: string,
  contextTokens: number,
): Row => ({
  id,
  name,
  provider: providerId === "ollama" ? "Ollama" : "Infomaniak",
  providerId,
  contextTokens,
});

const OLLAMA_FALLBACK: Catalog = Object.freeze([
  placeholderRow("ollama", "llama3.2", "Llama 3.2", 128_000),
  placeholderRow("ollama", "mistral", "Mistral", 32_000),
]);

const INFOMANIAK_FALLBACK: Catalog = Object.freeze([
  placeholderRow("infomaniak", "llama3", "Llama 3", 128_000),
  placeholderRow("infomaniak", "mixtral", "Mixtral", 32_000),
  placeholderRow("infomaniak", "qwen3", "Qwen 3", 32_000),
]);

const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : typeof error;

// --- OpenRouter -------------------------------------------------------------

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const ONE_HOUR_S = 60 * 60;

const openRouterFreeModels = async (): Promise<Catalog | null> => {
  try {
    const response = await fetch(OPENROUTER_MODELS_URL, {
      headers: { accept: "application/json" },
      next: { revalidate: ONE_HOUR_S },
    });
    if (response.ok) return parseFreeModels(await response.json());
    console.error("[model-catalog] OpenRouter list failed", response.status);
  } catch (error) {
    console.error("[model-catalog] OpenRouter unreachable", errorName(error));
  }
  return null;
};

// --- Ollama -----------------------------------------------------------------

const ollamaModels = async (): Promise<Catalog> => {
  const root = (serverEnv().OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL).replace(
    /\/v1\/?$/,
    "",
  );
  try {
    const response = await fetch(`${root}/api/tags`, { next: { revalidate: 60 } });
    const models = response.ok
      ? parseOllamaTags(await response.json(), serverEnv().OLLAMA_NUM_CTX)
      : null;
    return models !== null && models.length > 0 ? Object.freeze(models) : OLLAMA_FALLBACK;
  } catch {
    return OLLAMA_FALLBACK;
  }
};

// --- Infomaniak (legacy) ----------------------------------------------------

const infomaniakCache: { models: Catalog | null } = { models: null };

const settleInfomaniak = (models: Catalog, ...detail: readonly unknown[]): Catalog => {
  const source = models === INFOMANIAK_FALLBACK ? "static" : "live";
  console.warn(`[model-catalog] infomaniak allowlist source=${source}`, ...detail);
  infomaniakCache.models = models;
  return models;
};

const infomaniakModels = async (): Promise<Catalog> => {
  if (infomaniakCache.models !== null) return infomaniakCache.models;

  const env = serverEnv();
  const base = infomaniakOpenAiBaseUrl(env);
  const token = env.INFOMANIAK_API_TOKEN;
  if (base === null || token === undefined) return settleInfomaniak(INFOMANIAK_FALLBACK);

  try {
    const response = await fetch(`${base}/models`, {
      headers: { accept: "application/json", authorization: `Bearer ${token}` },
    });
    if (!response.ok) return settleInfomaniak(INFOMANIAK_FALLBACK, response.status);
    const live = parseInfomaniakModels(await response.json());
    return live === null
      ? settleInfomaniak(INFOMANIAK_FALLBACK)
      : settleInfomaniak(Object.freeze(live));
  } catch {
    return settleInfomaniak(INFOMANIAK_FALLBACK);
  }
};

export const resetInfomaniakCatalogCacheForTests = (): void => {
  infomaniakCache.models = null;
};

// --- vLLM (Exoscale, remote GPU) ---------------------------------------------

/** Provider id → (model id → the vLLM URL that listed it). */
export type VllmRouteTable = ReadonlyMap<VllmProviderId, ReadonlyMap<string, string>>;

/**
 * Newer routes override older ones, and older ones are kept. Replacing the
 * whole map let one fetch that missed a port make a model another request
 * had just been offered unroutable. A model no longer served keeps its stale
 * route, which is harmless: the chat route only accepts ids from the catalog
 * it has just fetched.
 */
export const mergeRemoteGpuRoutes = (
  previous: ReadonlyMap<string, string>,
  latest: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> => new Map([...previous.entries(), ...latest.entries()]);

/** Merges routes into one provider's slot; other providers keep theirs. */
export const mergeVllmRouteTable = (
  table: VllmRouteTable,
  providerId: VllmProviderId,
  latest: ReadonlyMap<string, string>,
): VllmRouteTable => {
  const merged = mergeRemoteGpuRoutes(table.get(providerId) ?? new Map(), latest);
  return new Map([...table.entries(), [providerId, merged]]);
};

/** The URL this provider's catalog listed for this model, or null. */
export const routeInTable = (
  table: VllmRouteTable,
  providerId: VllmProviderId,
  modelId: string,
): string | null => table.get(providerId)?.get(modelId) ?? null;

/**
 * Routes seen by every catalog fetch in this process, kept per provider so a
 * remote-gpu tunnel can never serve an exoscale id or the reverse. A model is
 * always resolved after the catalog has been fetched for that request.
 */
const vllm: { routes: VllmRouteTable } = { routes: new Map() };

const vllmModels = async (
  servers: Readonly<{ baseUrls: readonly string[]; apiKey: string | null }>,
  source: VllmSource,
): Promise<Catalog | null> => {
  const listed = await listRemoteGpuModels({ ...servers, fetch, source });
  listed.skipped.forEach(({ host, reason }) =>
    console.warn(`[model-catalog] ${source.providerId} skipped`, host, reason),
  );
  vllm.routes = mergeVllmRouteTable(vllm.routes, source.providerId, listed.routes);
  return listed.models.length === 0 ? null : listed.models;
};

/** The vLLM URL this provider's catalog listed for this model, or null. */
export const vllmBaseUrlFor = (
  providerId: VllmProviderId,
  modelId: string,
): string | null => routeInTable(vllm.routes, providerId, modelId);

// --- entry point ------------------------------------------------------------

/** The catalog for the configured provider, or null when none can be offered. */
export const fetchActiveModelCatalog = async (): Promise<Catalog | null> => {
  switch (serverEnv().LLM_PROVIDER) {
    case "ollama":
      return ollamaModels();
    case "infomaniak":
      return infomaniakModels();
    case "exoscale":
      return vllmModels(exoscaleEnv(), EXOSCALE_SOURCE);
    case "remote-gpu":
      return vllmModels(remoteGpuEnv(), REMOTE_GPU_SOURCE);
    case "openrouter":
      return openRouterFreeModels();
  }
};

/**
 * The catalog the chat offers: the agents (#218) in front of the provider's
 * models. The picker, the turn check and both chat routes read this one, so
 * an `agent:<id>` the browser sends is checked against the same list. The
 * caller passes the skills the server offers (`runnableSkills`), which this
 * layer cannot read itself.
 */
export const fetchChatCatalog = async (
  skills: AgentOffer["skills"],
): Promise<Catalog | null> => {
  const catalog = await fetchActiveModelCatalog();
  return catalog === null
    ? null
    : withAgents(catalog, {
        provider: serverEnv().LLM_PROVIDER,
        chatIsLocal: chatModelIsLocal(),
        skills,
      });
};

/** @deprecated Use fetchActiveModelCatalog; kept for existing imports. */
export const fetchFreeModelCatalog = fetchActiveModelCatalog;
