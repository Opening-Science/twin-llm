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

export const LLM_PROVIDERS = [
  "exoscale",
  "ollama",
  "openrouter",
  "remote-gpu",
  "infomaniak",
] as const;

export type LlmProvider = (typeof LLM_PROVIDERS)[number];

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

/**
 * The same refusal as a person reads it in the answer column: no code and no
 * setting names. It is stored on the refused answer's row and shown on reload.
 */
export const PROVIDER_NOT_PERMITTED_SENTENCE =
  "This model provider may not receive personal data or wearable context, so this model did not run.";

export type ProviderRequest = Readonly<{
  mode: DataMode;
  provider: LlmProvider;
  hasWearableNarrative: boolean;
  exoscalePersonalData: ExoscalePersonalData;
  /**
   * The request carries data the person imported on Customize · Data
   * (FHIR records, lab results, research tables; docs/personal-data.md).
   * Like wearable context it makes the request personal, and it is stricter:
   * only Ollama may receive it, never a hosted model, the consented Exoscale
   * pilot included. Absent means none.
   */
  hasImportedData?: boolean;
}>;

/** The data mode one request runs under: wearable context makes it personal. */
export const requestDataMode = (
  mode: DataMode,
  hasWearableNarrative: boolean,
): DataMode => (mode === "personal" || hasWearableNarrative ? "personal" : "synthetic");

const isPersonalRequest = (input: ProviderRequest): boolean =>
  input.hasImportedData === true ||
  requestDataMode(input.mode, input.hasWearableNarrative) === "personal";

const providerTakesPersonalData = (
  provider: LlmProvider,
  exoscalePersonalData: ExoscalePersonalData,
  hasImportedData: boolean,
): boolean =>
  hasImportedData
    ? provider === "ollama"
    : provider === "exoscale"
      ? exoscalePersonalData === "consented-pilot"
      : !SYNTHETIC_ONLY_PROVIDERS.has(provider);

/** Pure guard for the configured mode, without a request's wearable context. */
export const assertProviderAllowedForDataMode = (
  mode: DataMode,
  provider: LlmProvider,
  exoscalePersonalData: ExoscalePersonalData,
): void => {
  if (
    mode === "personal" &&
    !providerTakesPersonalData(provider, exoscalePersonalData, false)
  ) {
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
  !providerTakesPersonalData(
    input.provider,
    input.exoscalePersonalData,
    input.hasImportedData === true,
  )
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

/**
 * Imported data (Customize · Data, docs/personal-data.md) has its own gate,
 * the same shape as the genome's:
 *
 * - DATA_MODE=personal. A synthetic session never imports, stores or reads it.
 * - Only a model on this machine reads it: Ollama on loopback. No hosted
 *   provider, the consented Exoscale pilot included, and no MCP server, GBD
 *   tool or analytics event ever receives an imported value.
 *
 * Importing, reviewing, listing and deleting need only the first rule: no
 * model sees anything at those steps. Chat tools that read imported data
 * (a follow-up) must pass `permitImportedDataRequest` before each call.
 */
export type ImportedDataRequest = Readonly<{
  mode: DataMode;
  chatProvider: LlmProvider;
  chatOnLoopback: boolean;
}>;

export const IMPORTED_DATA_NOT_PERMITTED = "IMPORTED_DATA_NOT_PERMITTED" as const;

export type ImportedDataRefusalReason = "data-mode-not-personal" | "chat-model-not-local";

export type ImportedDataPermitDecision =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: typeof IMPORTED_DATA_NOT_PERMITTED;
      readonly reason: ImportedDataRefusalReason;
    };

/** May this server import, store, list or delete a person's own files? */
export const permitImportedDataStore = (mode: DataMode): ImportedDataPermitDecision =>
  mode === "personal"
    ? { ok: true }
    : { ok: false, code: IMPORTED_DATA_NOT_PERMITTED, reason: "data-mode-not-personal" };

/** May a chat model read imported data? Only Ollama on this machine, in personal mode. */
export const permitImportedDataRequest = (
  input: ImportedDataRequest,
): ImportedDataPermitDecision => {
  const stored = permitImportedDataStore(input.mode);
  if (!stored.ok) return stored;
  return input.chatProvider === "ollama" && input.chatOnLoopback
    ? { ok: true }
    : { ok: false, code: IMPORTED_DATA_NOT_PERMITTED, reason: "chat-model-not-local" };
};

/**
 * Genome requests (the Ark report and the Carbon-X DNA model) have their own
 * gate, stricter than the one above. A request may touch a genotype only when
 * every one of these holds:
 *
 * - DATA_MODE=personal. Synthetic sessions never see a genome.
 * - GENOME_SOURCE=ark. The report came from the owner's Ark after a phone approval.
 * - The chat model runs on this machine: ollama on loopback. A genotype is
 *   never sent to a hosted provider, the consented Exoscale pilot included.
 * - Carbon-X, the DNA model, is the local sidecar on loopback.
 *
 * No remote MCP server or GBD tool ever receives a genotype; those tools take
 * no genome input at all.
 */
export const CARBON_X_PROVIDER = "carbon-x" as const;

export type GenomeRequest = Readonly<{
  mode: DataMode;
  genomeSource: "none" | "ark";
  chatProvider: LlmProvider;
  chatOnLoopback: boolean;
  carbonXOnLoopback: boolean;
}>;

export const GENOME_NOT_PERMITTED = "GENOME_NOT_PERMITTED" as const;

export type GenomeRefusalReason =
  | "data-mode-not-personal"
  | "genome-source-not-ark"
  | "chat-model-not-local"
  | "carbon-x-not-local";

export type GenomePermitDecision =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: typeof GENOME_NOT_PERMITTED;
      readonly reason: GenomeRefusalReason;
    };

/**
 * Running the Ark app and storing its report on this machine needs only the
 * first two rules: no model sees anything at that step.
 */
export const permitGenomeRun = (
  input: Pick<GenomeRequest, "mode" | "genomeSource">,
): GenomePermitDecision =>
  input.mode !== "personal"
    ? { ok: false, code: GENOME_NOT_PERMITTED, reason: "data-mode-not-personal" }
    : input.genomeSource !== "ark"
      ? { ok: false, code: GENOME_NOT_PERMITTED, reason: "genome-source-not-ark" }
      : { ok: true };

/** The first rule a genome request breaks, in the order above, or ok. */
export const permitGenomeRequest = (input: GenomeRequest): GenomePermitDecision => {
  const broken: GenomeRefusalReason | null =
    input.mode !== "personal"
      ? "data-mode-not-personal"
      : input.genomeSource !== "ark"
        ? "genome-source-not-ark"
        : input.chatProvider !== "ollama" || !input.chatOnLoopback
          ? "chat-model-not-local"
          : !input.carbonXOnLoopback
            ? "carbon-x-not-local"
            : null;
  return broken === null
    ? { ok: true }
    : { ok: false, code: GENOME_NOT_PERMITTED, reason: broken };
};
