/**
 * Pure DATA_MODE policy (no server-only) — safe for unit tests.
 */

export type DataMode = "synthetic" | "personal";

export type LlmProvider =
  "exoscale" | "ollama" | "openrouter" | "remote-gpu" | "infomaniak";

/**
 * Third parties that may only ever see synthetic data: OpenRouter, and a rented
 * GPU reached through an SSH tunnel (its URL is on 127.0.0.1, the model is not).
 * Exoscale is not here: it is our own instance in Switzerland, so personal
 * wearable context may go there, as with Ollama. LOCAL_ONLY still refuses it
 * at startup, because it is off this machine.
 */
const SYNTHETIC_ONLY_PROVIDERS: ReadonlySet<LlmProvider> = new Set([
  "openrouter",
  "remote-gpu",
]);

export const PROVIDER_NOT_PERMITTED_FOR_DATA_MODE =
  "PROVIDER_NOT_PERMITTED_FOR_DATA_MODE" as const;

export const PROVIDER_NOT_PERMITTED_ERROR =
  "PROVIDER_NOT_PERMITTED_FOR_DATA_MODE: OpenRouter and the remote GPU are for synthetic data only. They are not permitted when DATA_MODE is personal or the request includes wearable context. Use exoscale or ollama.";

/** Pure guard used by runtime and unit tests. */
export const assertProviderAllowedForDataMode = (
  mode: DataMode,
  provider: LlmProvider,
): void => {
  if (mode === "personal" && SYNTHETIC_ONLY_PROVIDERS.has(provider)) {
    throw new Error(PROVIDER_NOT_PERMITTED_ERROR);
  }
};

export type ProviderPermitDecision =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: typeof PROVIDER_NOT_PERMITTED_FOR_DATA_MODE;
      readonly error: typeof PROVIDER_NOT_PERMITTED_ERROR;
    };

export const permitProviderForRequest = (input: {
  readonly mode: DataMode;
  readonly provider: LlmProvider;
  readonly hasWearableNarrative: boolean;
}): ProviderPermitDecision => {
  const restricted = input.mode === "personal" || input.hasWearableNarrative;
  if (restricted && SYNTHETIC_ONLY_PROVIDERS.has(input.provider)) {
    return {
      ok: false,
      code: PROVIDER_NOT_PERMITTED_FOR_DATA_MODE,
      error: PROVIDER_NOT_PERMITTED_ERROR,
    };
  }
  return { ok: true };
};
