import "server-only";

import { captureAiGeneration } from "@posthog/ai";

import { trackModelAnswered } from "@/infrastructure/analytics-events";
import { telemetryDisclosure } from "@/infrastructure/disclosure-ledger";
import { recordDisclosure } from "@/infrastructure/disclosure-ledger-runtime";
import { serverEnv } from "@/infrastructure/env";
import { database } from "@/infrastructure/database";
import { chatModelIsLocal } from "@/infrastructure/genome-gate";
import { posthogServer } from "@/infrastructure/posthog";
import { append } from "@/packages/audit/append";

import { createStreamModelResponse } from "./create-stream-model-response";
import { gbdLocalPortsIfImported } from "./gbd-local-tool-deps";
import { generationEvent } from "./generation-analytics";
import { genomeToolDepsFor, genomeVariantDepsFor } from "./genome-tool-deps";
import { importedToolDepsFor } from "./imported-tool-deps";
import { loadThreadViews } from "./load-thread-views";
import {
  markModelResponseComplete,
  markModelResponseFailed,
  markModelResponseRefused,
  markModelResponseStopped,
} from "./persist-model-response";
import { resolveLanguageModel } from "./resolve-language-model";
import { loadSessionAudit } from "./response/load-session-audit";

export type { StreamContext } from "./create-stream-model-response";

/**
 * One model's answer for a saved thread: streamed to the browser and stored on
 * the `ModelResponse` row `startTurn` created, with the funnel and generation
 * analytics. The pipeline itself is `create-stream-model-response.ts`.
 */
export const streamModelResponse = createStreamModelResponse({
  settings: () => {
    const env = serverEnv();
    return { dataMode: env.DATA_MODE, provider: env.LLM_PROVIDER };
  },
  chatIsLocal: chatModelIsLocal,
  resolveModel: resolveLanguageModel,
  genomeTools: genomeToolDepsFor,
  variantTools: genomeVariantDepsFor,
  importedTools: importedToolDepsFor,
  gbdLocal: gbdLocalPortsIfImported,
  loadAudit: loadSessionAudit,
  store: {
    writeComplete: markModelResponseComplete,
    writeStopped: markModelResponseStopped,
    writeFailed: markModelResponseFailed,
    markRefused: markModelResponseRefused,
    loadViews: loadThreadViews,
  },
  appendAudit: (input) => append(database(), input),
  analytics: {
    answered: trackModelAnswered,
    generation: async (facts) => {
      const client = posthogServer();
      const event = generationEvent(facts);
      if (client === null || event === null) return;
      // In the disclosure ledger (#140) first; a failed write drops the event.
      await recordDisclosure(
        telemetryDisclosure({
          distinctId: facts.distinctId,
          event: "$ai_generation",
          synthetic: facts.mode === "synthetic",
        }),
      );
      await captureAiGeneration(client, event);
    },
  },
});
