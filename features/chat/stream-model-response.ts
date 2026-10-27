import "server-only";

import { captureAiGeneration } from "@posthog/ai";

import { trackModelAnswered } from "@/infrastructure/analytics-events";
import { serverEnv } from "@/infrastructure/env";
import { chatModelIsLocal } from "@/infrastructure/genome-gate";
import type { GoogleHealthSummary } from "@/infrastructure/google-health-types";
import type { KnowledgeSourceId } from "@/infrastructure/knowledge-sources";
import {
  type ChatUIMessage,
  createResponseTimer,
  type ModelResponseMetrics,
} from "@/infrastructure/model-response-metrics";
import type { OuraSummary } from "@/infrastructure/oura-types";
import { posthogServer } from "@/infrastructure/posthog";
import type { TurnSkill } from "@/infrastructure/skill-gate";
import type { VitronicSummary } from "@/infrastructure/vitronic-types";
import type { WhoopSummary } from "@/infrastructure/whoop-types";

import type { ChatRequest } from "./chat-request";
import { createChatTools, forSkill, forSources } from "./chat-tools";
import { finishModelResponse } from "./finish-model-response";
import { generationEvent } from "./generation-analytics";
import { guardGenomeHistory } from "./genome-history-guard";
import { genomeToolDepsFor } from "./genome-tool-deps";
import { errorNameOf, modelFailureLog } from "./model-failure-log";
import {
  markModelResponseComplete,
  markModelResponseFailed,
  markModelResponseRefused,
} from "./persist-model-response";
import { resolveLanguageModel } from "./resolve-language-model";
import type { ResponseDocumentV1 } from "./response/document-v1";
import { loadSessionAudit } from "./response/load-session-audit";
import { chatResponseMetadata } from "./response-document";
import { runTwinTurn } from "./run-twin-turn";
import { twinUIMessageResponse } from "./twin-ui-stream";

/**
 * One model's answer, streamed to the browser and stored.
 *
 * `runTwinTurn` (shared with the eval harness) owns the model call itself:
 * prompt, tools, step limit, parsing and the response document. This module
 * wraps it with the browser stream, the database row and analytics.
 *
 * The final metadata (metrics plus response document) is sent only after the
 * document has been built from this turn's audit rows, so the browser never
 * sees a document from a half-read audit. Until then the UI stream holds its
 * finish chunk and keeps the connection alive with heartbeats. If the browser
 * leaves, the turn still finishes and is stored, so a reload shows it.
 */

export type StreamContext = Readonly<{
  clerkId: string;
  /**
   * The thread used a genome tool, the history shows one, or the turn asks
   * for one (`start-answer`). Required, so no caller can forget to decide.
   */
  genomeThread: boolean;
  ouraSummary: OuraSummary | null;
  whoopSummary: WhoopSummary | null;
  googleHealthSummary: GoogleHealthSummary | null;
  vitronicSummary: VitronicSummary | null;
  /** Knowledge sources this user turned off at /start; their tools are left out. */
  disabledSources?: readonly KnowledgeSourceId[];
  /** The skill this turn runs under, already permitted by `start-answer`. */
  skill?: TurnSkill | null;
}>;

type Outcome = Readonly<{ metrics: ModelResponseMetrics; document: ResponseDocumentV1 }>;

/** A promise settled from outside, at most once; later calls are ignored. */
const settleOnce = <T>() => {
  const box: { resolve: (value: T) => void } = { resolve: () => undefined };
  const promise = new Promise<T>((resolve) => {
    box.resolve = resolve;
  });
  return { promise, settle: (value: T) => box.resolve(value) };
};

const USER_FACING_FAILURE =
  "This model didn't come back. You can try it again, the others aren't affected.";

export const streamModelResponse = async (
  request: ChatRequest,
  context: StreamContext,
): Promise<Response> => {
  const { modelId, turnId, messages } = request;
  const { clerkId } = context;
  const held = await guardGenomeHistory(
    { chatIsLocal: chatModelIsLocal, markRefused: markModelResponseRefused },
    request,
    context.genomeThread,
  );
  if (held !== null) return held;

  const env = serverEnv();
  const timer = createResponseTimer(modelId);
  const outcome = settleOnce<Outcome | null>();

  const sources = {
    oura: context.ouraSummary !== null,
    whoop: context.whoopSummary !== null,
    googleHealth: context.googleHealthSummary !== null,
    vitronic: context.vitronicSummary !== null,
  };
  const hasWearableNarrative = Object.values(sources).some(Boolean);
  const turnWearables = {
    oura: context.ouraSummary,
    whoop: context.whoopSummary,
    googleHealth: context.googleHealthSummary,
    vitronic: context.vitronicSummary,
  };

  const skill = context.skill ?? null;
  const scope = { actor: clerkId, sessionId: turnId, mode: env.DATA_MODE };
  const { tools, offeredTools } = forSkill(
    forSources(
      createChatTools(scope, {
        hasWearableNarrative,
        wearables: turnWearables,
        disabledSources: context.disabledSources,
        views: skill?.views,
        genome: genomeToolDepsFor(scope),
      }),
      context.disabledSources ?? [],
    ).tools,
    skill,
  );

  const logStep = (step: string) => (error: unknown) =>
    console.error(`[chat] ${modelId} ${step}`, errorNameOf(error));

  const turn = runTwinTurn(
    {
      model: resolveLanguageModel(modelId, { hasWearableNarrative }),
      tools,
      offeredTools,
      mode: env.DATA_MODE,
      skill,
      loadAudit: loadSessionAudit,
    },
    {
      turnId,
      messages,
      wearables: turnWearables,
    },
    {
      onFirstToken: () => timer.markFirstToken(),
      onFinish: async ({ text, usage, parsed, toolResults, buildDocument }) => {
        try {
          const metrics = timer.read(usage);
          const finished = await finishModelResponse({
            buildDocument,
            writeComplete: (document) =>
              markModelResponseComplete({
                turnId,
                modelId,
                text,
                metrics,
                reasoningText: parsed.reasoningText,
                attribution: parsed.attribution,
                document,
                toolResults,
              }),
            writeFailed: () => markModelResponseFailed({ turnId, modelId }),
            logError: (message, name) =>
              console.error(`[chat] ${modelId} ${message}`, name),
          });
          // Ends the browser stream; metadata goes out only with a document.
          outcome.settle(
            finished.document === null ? null : { metrics, document: finished.document },
          );
          trackModelAnswered({ clerkId, turnId, modelId, status: finished.status });

          const client = posthogServer();
          const event = generationEvent({
            mode: env.DATA_MODE,
            distinctId: clerkId,
            provider: env.LLM_PROVIDER,
            modelId,
            turnId,
            metrics,
            attributionCount: parsed.attribution.length,
            hallucinatedKeyCount: parsed.hallucinatedKeys.length,
            contextSources: sources,
          });
          if (client !== null && event !== null) {
            await captureAiGeneration(client, event).catch(
              logStep("analytics capture failed"),
            );
          }
        } finally {
          // Only matters when something above threw: the stream must still end.
          outcome.settle(null);
        }
      },
      onError: async (error) => {
        console.error(`[chat] model ${modelId} failed`, modelFailureLog(error));
        await markModelResponseFailed({ turnId, modelId }).catch(
          logStep("could not record the answer as failed"),
        );
        trackModelAnswered({ clerkId, turnId, modelId, status: "FAILED" });
        outcome.settle(null);
      },
      onAbort: () => outcome.settle(null),
    },
  );

  const failureText = (): string => USER_FACING_FAILURE;

  return twinUIMessageResponse({
    modelStream: turn.toUIMessageStream<ChatUIMessage>({
      sendFinish: false,
      onError: failureText,
    }),
    finished: outcome.promise.then((done) =>
      done === null ? null : chatResponseMetadata(done.metrics, done.document),
    ),
    onError: failureText,
  });
};
