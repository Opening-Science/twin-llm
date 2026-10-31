import "server-only";

import { createOpenRouter, type OpenRouterProvider } from "@openrouter/ai-sdk-provider";

import { serverEnv } from "@/infrastructure/env";

/**
 * An OpenRouter provider, built per model call so each call can send through
 * its own recording fetch (the disclosure ledger, #140). Built on use, never
 * at import, so `next build` does not need a real API key.
 *
 * The referer and title headers are what make this app show up by name in
 * OpenRouter's own dashboard, which is the only place the per-call accounting
 * can be checked against what we display.
 */
export const openrouter = (fetchFn: typeof fetch): OpenRouterProvider => {
  const apiKey = serverEnv().OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is required when LLM_PROVIDER=openrouter");
  }
  return createOpenRouter({
    apiKey,
    headers: {
      "HTTP-Referer": "https://twin-llm.local",
      "X-Title": "TwinLLM",
    },
    fetch: fetchFn,
  });
};
