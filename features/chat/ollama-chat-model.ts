import { defaultSettingsMiddleware, type LanguageModel, wrapLanguageModel } from "ai";
import { createOllama } from "ollama-ai-provider-v2";

import { ollamaApiRoot } from "@/infrastructure/ollama-context";

/**
 * A chat model on Ollama's native `/api/chat`, loaded with `numCtx` tokens of
 * context. The OpenAI-compatible `/v1` endpoint ignores `num_ctx`, so a model
 * reached there runs with Ollama's 4096-token default and loses the start of
 * the prompt, tool definitions first (issue #149).
 *
 * `think` is off: the fine-tuned models have no thinking mode and Ollama
 * refuses `think: true` for them, and the twin prompt already asks for the
 * reasoning as a written section. A hidden thinking pass would also spend the
 * context the tools need.
 */
export type OllamaChatModelConfig = Readonly<{
  /** `OLLAMA_BASE_URL`, the OpenAI-compatible root ending in `/v1`. */
  baseUrl: string;
  numCtx: number;
  /** Tests and the request-size script pass a recording fetch. */
  fetch?: typeof fetch;
}>;

type WrappableModel = Parameters<typeof wrapLanguageModel>[0]["model"];

export const ollamaProviderOptions = (numCtx: number) => ({
  ollama: { think: false, options: { num_ctx: numCtx } },
});

export const ollamaChatModel = (
  modelId: string,
  config: OllamaChatModelConfig,
): LanguageModel => {
  const native = createOllama({
    baseURL: ollamaApiRoot(config.baseUrl),
    fetch: config.fetch,
  }).chat(modelId);
  return wrapLanguageModel({
    // The provider builds on a newer copy of @ai-sdk/provider than the one
    // `ai` pins; both are the same "v4" model spec and differ only in how
    // readonly their JSON types are, so the model passes through unchanged.
    model: native as unknown as WrappableModel,
    middleware: defaultSettingsMiddleware({
      settings: { providerOptions: ollamaProviderOptions(config.numCtx) },
    }),
  });
};
