import type { DataMode, LlmProvider } from "@/infrastructure/data-mode-policy";

/**
 * "Where your data goes", from the server's real configuration.
 *
 * Which provider runs is read from env at startup (`LOCAL_ONLY`,
 * `LLM_PROVIDER`), so the step shows it read-only and says how it is set,
 * rather than offering a switch that could not do anything. The rows follow
 * README "What leaves this machine" and docs/providers.md; keep them in step.
 */

export type ResidencyConfig = Readonly<{
  localOnly: boolean;
  provider: LlmProvider;
  dataMode: DataMode;
  gbdConfigured: boolean;
  /** `OLLAMA_BASE_URL` is on loopback; only read when the provider is ollama. */
  ollamaOnLoopback: boolean;
}>;

/** Where a row's data ends up, said in a word as well as a sentence. */
export type ResidencyTone = "stays" | "leaves" | "download" | "off";

export type ResidencyRow = Readonly<{
  id: string;
  label: string;
  where: string;
  tone: ResidencyTone;
}>;

export type ResidencyChoice = "local-only" | "own-cloud" | "other";

export const RESIDENCY_TONE_LABEL: Readonly<Record<ResidencyTone, string>> = {
  stays: "Stays here",
  leaves: "Leaves",
  download: "Download only",
  off: "Off",
};

const PROVIDER_DESTINATION: Readonly<Record<LlmProvider, string>> = {
  exoscale: "Sent to our own open models on Exoscale in Switzerland.",
  ollama: "Sent to the Ollama server at the configured address.",
  infomaniak: "Sent to Infomaniak in Switzerland (legacy).",
  openrouter:
    "Sent to OpenRouter, synthetic data only and never with a wearable snapshot.",
  "remote-gpu":
    "Sent to a rented GPU through an SSH tunnel, synthetic data only and never with a wearable snapshot.",
};

export const PROVIDER_NAME: Readonly<Record<LlmProvider, string>> = {
  exoscale: "Exoscale (our own models, Switzerland)",
  ollama: "Ollama",
  infomaniak: "Infomaniak (legacy)",
  openrouter: "OpenRouter",
  "remote-gpu": "Remote GPU",
};

const modelOnThisMachine = (config: ResidencyConfig): boolean =>
  config.localOnly || (config.provider === "ollama" && config.ollamaOnLoopback);

export const residencyChoice = (config: ResidencyConfig): ResidencyChoice =>
  config.localOnly
    ? "local-only"
    : config.provider === "exoscale"
      ? "own-cloud"
      : "other";

export const HOW_TO_SWITCH =
  "Whoever runs this server sets this in .env.local (LOCAL_ONLY and LLM_PROVIDER) and restarts it. It cannot be switched from the browser.";

export const residencyRows = (config: ResidencyConfig): readonly ResidencyRow[] => [
  {
    id: "chat",
    label: "Chat prompt, wearable summaries, BodyLoop measurements, tool results",
    where: modelOnThisMachine(config)
      ? "Stays on this machine: Ollama on loopback."
      : PROVIDER_DESTINATION[config.provider],
    tone: modelOnThisMachine(config) ? "stays" : "leaves",
  },
  {
    id: "embeddings",
    label: "Guideline search embeddings",
    where:
      config.localOnly || config.ollamaOnLoopback
        ? "Stay on this machine."
        : "Sent to the Ollama server at the configured address.",
    tone: config.localOnly || config.ollamaOnLoopback ? "stays" : "leaves",
  },
  {
    id: "wearables",
    label: "Wearable data",
    where:
      "Downloaded from each vendor's cloud over OAuth. Nothing from TwinLLM is uploaded to them.",
    tone: "download",
  },
  {
    id: "gbd",
    label: "Population data (GBD)",
    where: config.localOnly
      ? "Off in local-only mode."
      : config.gbdConfigured
        ? "The query is sent to the remote GBD server."
        : "Not set up on this server.",
    tone: !config.localOnly && config.gbdConfigured ? "leaves" : "off",
  },
  {
    id: "services",
    label: "Analytics and sign-in (PostHog, Arcjet, Clerk)",
    where: config.localOnly
      ? "Off in local-only mode."
      : "Used only when their keys are set on this server.",
    tone: config.localOnly ? "off" : "leaves",
  },
  {
    id: "bodyloop",
    label: "BodyLoop scan",
    where: "Read from the scanner on the local network.",
    tone: "stays",
  },
  {
    id: "genome",
    label: "Genome (Ark)",
    where: "Stays on the device; TwinLLM reads its status only.",
    tone: "stays",
  },
  {
    id: "secrets",
    label: "Tokens, FHIR bundles, raw vendor payloads, scan mesh and markers",
    where: "Never leave this machine.",
    tone: "stays",
  },
];

export const dataModeSentence = (mode: DataMode): string =>
  mode === "synthetic"
    ? "This server runs on synthetic data (DATA_MODE=synthetic)."
    : "This server runs on personal data (DATA_MODE=personal). OpenRouter and the remote GPU are refused.";

/** The line under the "what do you want to explore" box. */
export const interestHint = (config: ResidencyConfig): string => {
  const chat = residencyRows(config).find((row) => row.id === "chat");
  return chat?.tone === "leaves"
    ? `Leave out names and other personal details. What you type goes to the model that writes the starters. ${chat.where}`
    : "Leave out names and other personal details. What you type stays on this machine.";
};
