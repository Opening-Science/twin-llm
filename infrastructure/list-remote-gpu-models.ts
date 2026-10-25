import {
  parseVllmModels,
  REMOTE_GPU_SOURCE,
  type CatalogModel,
  type VllmSource,
} from "./model-catalog";

/**
 * The model list of one or more vLLM servers: the remote GPU's SSH tunnels, or
 * our Exoscale instance (one server per GPU). Kept apart from `fetch-model-catalog.ts` on purpose:
 * it reads no env and gets `fetch` passed in, so it needs no `server-only`
 * guard and its tests import it directly. The env read, the logging and the
 * per-process route table stay in the `server-only` caller.
 */

/** A vLLM server lists its models in milliseconds or not at all; a page render never waits longer. */
const REMOTE_GPU_TIMEOUT_MS = 5000;

type FetchModels = (url: string, init: RequestInit) => Promise<Response>;

export type RemoteGpuSkip = Readonly<{ host: string; reason: string }>;

export type RemoteGpuCatalog = Readonly<{
  models: readonly CatalogModel[];
  /** Model id → the base URL that listed it. Chat for that id goes there. */
  routes: ReadonlyMap<string, string>;
  /** URLs that gave no list, by host only. The pod may simply be off. */
  skipped: readonly RemoteGpuSkip[];
}>;

type RemoteGpuListing =
  | { readonly baseUrl: string; readonly models: readonly CatalogModel[] }
  | { readonly skip: RemoteGpuSkip };

const listOneRemoteGpu = async (
  baseUrl: string,
  deps: Readonly<{ apiKey: string | null; fetch: FetchModels; source: VllmSource }>,
): Promise<RemoteGpuListing> => {
  const host = new URL(baseUrl).host;
  try {
    const response = await deps.fetch(`${baseUrl}/models`, {
      headers: {
        Accept: "application/json",
        ...(deps.apiKey ? { Authorization: `Bearer ${deps.apiKey}` } : {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(REMOTE_GPU_TIMEOUT_MS),
    });
    if (!response.ok) return { skip: { host, reason: `status ${response.status}` } };
    const models = parseVllmModels(await response.json().catch(() => null), deps.source);
    return models ? { baseUrl, models } : { skip: { host, reason: "unexpected body" } };
  } catch {
    return { skip: { host, reason: "unreachable" } };
  }
};

const EMPTY_REMOTE_GPU_CATALOG: RemoteGpuCatalog = {
  models: [],
  routes: new Map(),
  skipped: [],
};

/**
 * Lists `GET {url}/models` on every vLLM server and merges them in URL order. Two ports can serve the same weights under different names, so each
 * id remembers which URL listed it; if two URLs list the same id, the first
 * wins. One dead tunnel never hides the others.
 */
export const listRemoteGpuModels = async (
  deps: Readonly<{
    baseUrls: readonly string[];
    apiKey: string | null;
    fetch: FetchModels;
    /** Label for the rows; the remote GPU when not given. */
    source?: VllmSource;
  }>,
): Promise<RemoteGpuCatalog> => {
  const source = deps.source ?? REMOTE_GPU_SOURCE;
  const listings = await Promise.all(
    deps.baseUrls.map((url) =>
      listOneRemoteGpu(url.replace(/\/+$/, ""), { ...deps, source }),
    ),
  );
  return listings.reduce<RemoteGpuCatalog>(
    (merged, listing) =>
      "skip" in listing
        ? { ...merged, skipped: [...merged.skipped, listing.skip] }
        : listing.models.reduce<RemoteGpuCatalog>(
            (inner, model) =>
              inner.routes.has(model.id)
                ? inner
                : {
                    ...inner,
                    models: [...inner.models, model],
                    routes: new Map(inner.routes).set(model.id, listing.baseUrl),
                  },
            merged,
          ),
    EMPTY_REMOTE_GPU_CATALOG,
  );
};
