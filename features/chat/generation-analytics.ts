import type { captureAiGeneration } from "@posthog/ai";

import type { ModelResponseMetrics } from "@/infrastructure/model-response-metrics";

/**
 * The PostHog LLM-analytics event for one finished model call, or null when
 * none may be sent.
 *
 * Only metrics leave: model, provider, latency, token counts and a few
 * counts and flags. Prompt and answer are passed as null and `privacyMode`
 * is set, so the library drops them even if a later edit passes text. The
 * posthog-node client option of the same name is not relied on; it is not
 * read at runtime by the installed version.
 *
 * In DATA_MODE=personal nothing is sent at all: even metadata such as which
 * wearable sources were present describes a person.
 */
export type GenerationFacts = Readonly<{
  mode: "personal" | "synthetic";
  distinctId: string;
  provider: string;
  modelId: string;
  turnId: string;
  metrics: ModelResponseMetrics;
  attributionCount: number;
  hallucinatedKeyCount: number;
  contextSources: Readonly<{
    oura: boolean;
    whoop: boolean;
    googleHealth: boolean;
    vitronic: boolean;
  }>;
}>;

type GenerationEvent = Parameters<typeof captureAiGeneration>[1] & { privacyMode: true };

const seconds = (ms: number | null): number | undefined =>
  ms === null ? undefined : ms / 1000;

export const generationEvent = (facts: GenerationFacts): GenerationEvent | null => {
  if (facts.mode === "personal") return null;
  const { metrics, contextSources } = facts;
  return {
    distinctId: facts.distinctId,
    provider: facts.provider,
    model: facts.modelId,
    input: null,
    output: null,
    privacyMode: true,
    latency: seconds(metrics.timeToFirstTokenMs),
    usage: {
      inputTokens: metrics.inputTokens ?? undefined,
      outputTokens: metrics.outputTokens ?? undefined,
    },
    properties: {
      turnId: facts.turnId,
      attributionCount: facts.attributionCount,
      hallucinatedKeyCount: facts.hallucinatedKeyCount,
      hasOuraContext: contextSources.oura,
      hasWhoopContext: contextSources.whoop,
      hasGoogleHealthContext: contextSources.googleHealth,
      hasVitronicContext: contextSources.vitronic,
    },
  };
};
