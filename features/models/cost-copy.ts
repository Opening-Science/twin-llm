import type { LlmProvider } from "@/infrastructure/data-mode";

/**
 * What the Models screen may say about cost, per provider. Ollama runs
 * on this machine and the OpenRouter catalog is free-tier only, so their calls
 * cost nothing. A remote GPU pod is billed by the hour while it runs, whatever
 * the calls, and so is our Exoscale GPU instance; Infomaniak (legacy) bills
 * its own account, so nothing is claimed for it.
 */
export type CostCopy = Readonly<{ sentence: string; perModel: boolean }> | null;

export const costCopy = (provider: LlmProvider): CostCopy => {
  switch (provider) {
    case "ollama":
    case "openrouter":
      return { sentence: "All listed calls are free.", perModel: true };
    case "remote-gpu":
      return {
        sentence:
          "Calls carry no charge of their own, but the GPU pod is billed by the hour while it runs.",
        perModel: false,
      };
    case "exoscale":
      return {
        sentence:
          "Calls carry no charge of their own, but the Exoscale GPU instance is billed by the hour while it runs.",
        perModel: false,
      };
    case "infomaniak":
      return null;
  }
};
