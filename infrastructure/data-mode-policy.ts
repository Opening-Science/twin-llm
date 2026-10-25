/**
 * Pure DATA_MODE policy (no server-only) — safe for unit tests.
 *
 * A request is personal when DATA_MODE=personal or it carries wearable
 * context. Where a personal request may go:
 *
 * - ollama: always. With LOCAL_ONLY it is on this machine.
 * - exoscale: only with EXOSCALE_PERSONAL_DATA=consented-pilot. The instance
 *   is ours, but the hosting operator can technically read the memory of a
 *   running instance, so until confidential computing ships it may only see
 *   synthetic data or data from people who consented to a pilot.
 * - openrouter, remote-gpu and infomaniak (legacy): never. They are third-party
 *   services, and no third-party model ever sees personal data.
 *
 * LOCAL_ONLY still refuses every provider but ollama at startup.
 */

export type DataMode = "synthetic" | "personal";

export type LlmProvider =
  "exoscale" | "ollama" | "openrouter" | "remote-gpu" | "infomaniak";

/** Values of EXOSCALE_PERSONAL_DATA; the first is the default. */
export const EXOSCALE_PERSONAL_DATA_SETTINGS = ["off", "consented-pilot"] as const;

export type ExoscalePersonalData = (typeof EXOSCALE_PERSONAL_DATA_SETTINGS)[number];

/** Third parties that may only ever see synthetic data. */
const SYNTHETIC_ONLY_PROVIDERS: ReadonlySet<LlmProvider> = new Set([
  "openrouter",
  "remote-gpu",
  "infomaniak",
]);

export const PROVIDER_NOT_PERMITTED_FOR_DATA_MODE =
  "PROVIDER_NOT_PERMITTED_FOR_DATA_MODE" as const;

export const PROVIDER_NOT_PERMITTED_ERROR =
  "PROVIDER_NOT_PERMITTED_FOR_DATA_MODE: This model provider may not receive personal data or wearable context. Use local Ollama, or Exoscale with EXOSCALE_PERSONAL_DATA=consented-pilot for a consented pilot.";

export type ProviderRequest = Readonly<{
  mode: DataMode;
  provider: LlmProvider;
  hasWearableNarrative: boolean;
  exoscalePersonalData: ExoscalePersonalData;
}>;

const isPersonalRequest = (input: ProviderRequest): boolean =>
  input.mode === "personal" || input.hasWearableNarrative;

const providerTakesPersonalData = (
  provider: LlmProvider,
  exoscalePersonalData: ExoscalePersonalData,
): boolean =>
  provider === "exoscale"
    ? exoscalePersonalData === "consented-pilot"
    : !SYNTHETIC_ONLY_PROVIDERS.has(provider);

/** Pure guard for the configured mode, without a request's wearable context. */
export const assertProviderAllowedForDataMode = (
  mode: DataMode,
  provider: LlmProvider,
  exoscalePersonalData: ExoscalePersonalData,
): void => {
  if (mode === "personal" && !providerTakesPersonalData(provider, exoscalePersonalData)) {
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

export const permitProviderForRequest = (
  input: ProviderRequest,
): ProviderPermitDecision =>
  isPersonalRequest(input) &&
  !providerTakesPersonalData(input.provider, input.exoscalePersonalData)
    ? {
        ok: false,
        code: PROVIDER_NOT_PERMITTED_FOR_DATA_MODE,
        error: PROVIDER_NOT_PERMITTED_ERROR,
      }
    : { ok: true };

/**
 * True when a request sends personal data to a hosted model under the
 * consented pilot. The chat route writes each one to the audit chain.
 */
export const sendsPersonalDataToHostedModel = (input: ProviderRequest): boolean =>
  isPersonalRequest(input) &&
  input.provider === "exoscale" &&
  input.exoscalePersonalData === "consented-pilot";

/** Audit `tool` name for one personal request sent to a hosted model. */
export const PERSONAL_DATA_SENT_AUDIT_TOOL = "provider.personal_data_sent";
