import "server-only";

import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

import {
  permitProviderForRequest,
  PROVIDER_NOT_PERMITTED_ERROR,
  PROVIDER_NOT_PERMITTED_FOR_DATA_MODE,
} from "@/infrastructure/data-mode";
import {
  exoscaleEnv,
  exoscalePersonalData,
  infomaniakOpenAiBaseUrl,
  serverEnv,
} from "@/infrastructure/env";
import { vllmBaseUrlFor } from "@/infrastructure/fetch-model-catalog";
import { withFirstByteTimeout } from "@/infrastructure/first-byte-timeout-fetch";

import { ollamaChatModel } from "./ollama-chat-model";
import { openrouter } from "./openrouter";

const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434/v1";

export class ProviderNotPermittedError extends Error {
  readonly code = PROVIDER_NOT_PERMITTED_FOR_DATA_MODE;

  constructor() {
    super(PROVIDER_NOT_PERMITTED_ERROR);
    this.name = "ProviderNotPermittedError";
  }
}

export const REMOTE_GPU_MODEL_NOT_LISTED =
  "REMOTE_GPU_MODEL_NOT_LISTED: no remote GPU tunnel lists this model; reload the model list";

/** vLLM started without `--api-key` ignores the header, but the SDK wants a value. */
const REMOTE_GPU_PLACEHOLDER_KEY = "remote-gpu";

export const EXOSCALE_MODEL_NOT_LISTED =
  "EXOSCALE_MODEL_NOT_LISTED: no Exoscale vLLM server lists this model; reload the model list";

/** Same as above: vLLM without `--api-key` ignores the header. */
const EXOSCALE_PLACEHOLDER_KEY = "exoscale";

export type RemoteGpuTarget = Readonly<{ baseURL: string; apiKey: string }>;

/**
 * Where a remote-gpu chat goes: the tunnel URL whose `/v1/models` listed this
 * id. Two ports can serve different models, so guessing the first URL would
 * send a request to a server that answers 404.
 */
export const remoteGpuTarget = (
  modelId: string,
  deps: Readonly<{
    baseUrlFor: (modelId: string) => string | null;
    apiKey: string | null;
  }>,
): RemoteGpuTarget => {
  const baseURL = deps.baseUrlFor(modelId);
  if (!baseURL) throw new Error(REMOTE_GPU_MODEL_NOT_LISTED);
  return { baseURL, apiKey: deps.apiKey ?? REMOTE_GPU_PLACEHOLDER_KEY };
};

export type ExoscaleTarget = Readonly<{
  baseURL: string;
  apiKey: string;
  fetch: typeof fetch;
}>;

/**
 * Where an exoscale chat goes: the vLLM server (one per GPU) whose
 * `/v1/models` listed this id, through a fetch that gives up when the answer
 * has not started after `firstByteTimeoutMs`. That abort is never retried.
 */
export const exoscaleTarget = (
  modelId: string,
  deps: Readonly<{
    baseUrlFor: (modelId: string) => string | null;
    apiKey: string | null;
    firstByteTimeoutMs: number;
    fetch: typeof fetch;
  }>,
): ExoscaleTarget => {
  const baseURL = deps.baseUrlFor(modelId);
  if (!baseURL) throw new Error(EXOSCALE_MODEL_NOT_LISTED);
  return {
    baseURL,
    apiKey: deps.apiKey ?? EXOSCALE_PLACEHOLDER_KEY,
    fetch: withFirstByteTimeout({
      fetch: deps.fetch,
      timeoutMs: deps.firstByteTimeoutMs,
    }),
  };
};

/**
 * Resolves a LanguageModel for the given catalog id.
 *
 * Providers:
 * - exoscale — default without LOCAL_ONLY: our own vLLM servers on an Exoscale
 *   GPU instance in Switzerland; each id goes to the server that listed it
 * - ollama — local daemon (default with LOCAL_ONLY), on its native chat API
 *   so the request can set the context size (OLLAMA_NUM_CTX)
 * - remote-gpu — vLLM on a rented GPU behind SSH tunnels; each id goes to the
 *   tunnel URL that listed it
 * - openrouter — free OSS catalog
 * - infomaniak — legacy; only when named explicitly
 *
 * openrouter, remote-gpu and infomaniak are forbidden when DATA_MODE=personal or when
 * hasWearableNarrative is true, and so is exoscale unless
 * EXOSCALE_PERSONAL_DATA=consented-pilot. Same permitProviderForRequest check
 * as the chat route (defence in depth).
 */
export const resolveLanguageModel = (
  modelId: string,
  { hasWearableNarrative }: { readonly hasWearableNarrative: boolean },
): LanguageModel => {
  const env = serverEnv();
  const permit = permitProviderForRequest({
    mode: env.DATA_MODE,
    provider: env.LLM_PROVIDER,
    hasWearableNarrative,
    exoscalePersonalData: exoscalePersonalData(env),
  });
  if (!permit.ok) {
    throw new ProviderNotPermittedError();
  }

  if (env.LLM_PROVIDER === "ollama") {
    return ollamaChatModel(modelId, {
      baseUrl: env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL,
      numCtx: env.OLLAMA_NUM_CTX,
    });
  }

  if (env.LLM_PROVIDER === "exoscale") {
    const exoscale = exoscaleEnv();
    const target = exoscaleTarget(modelId, {
      baseUrlFor: (id) => vllmBaseUrlFor("exoscale", id),
      apiKey: exoscale.apiKey,
      firstByteTimeoutMs: exoscale.firstByteTimeoutMs,
      fetch,
    });
    return createOpenAI(target).chat(modelId);
  }

  if (env.LLM_PROVIDER === "infomaniak") {
    const token = env.INFOMANIAK_API_TOKEN;
    const baseURL = infomaniakOpenAiBaseUrl(env);
    if (!token || !baseURL) {
      throw new Error(
        "INFOMANIAK_PRODUCT_ID and INFOMANIAK_API_TOKEN are required when LLM_PROVIDER=infomaniak",
      );
    }
    const infomaniak = createOpenAI({
      apiKey: token,
      baseURL,
    });
    return infomaniak.chat(modelId);
  }

  if (env.LLM_PROVIDER === "remote-gpu") {
    const target = remoteGpuTarget(modelId, {
      baseUrlFor: (id) => vllmBaseUrlFor("remote-gpu", id),
      apiKey: env.REMOTE_GPU_API_KEY ?? null,
    });
    return createOpenAI(target).chat(modelId);
  }

  return openrouter()(modelId);
};
