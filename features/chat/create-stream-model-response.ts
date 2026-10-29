import type { LanguageModel } from "ai";

import type { DataMode, LlmProvider } from "@/infrastructure/data-mode-policy";
import type { GoogleHealthSummary } from "@/infrastructure/google-health-types";
import type { KnowledgeSourceId } from "@/infrastructure/knowledge-sources";
import type { CatalogAgent } from "@/infrastructure/model-catalog";
import {
  type ChatUIMessage,
  createResponseTimer,
  type ModelResponseMetrics,
} from "@/infrastructure/model-response-metrics";
import type { OuraSummary } from "@/infrastructure/oura-types";
import type { TurnSkill } from "@/infrastructure/skill-gate";
import type { VitronicSummary } from "@/infrastructure/vitronic-types";
import type { WhoopSummary } from "@/infrastructure/whoop-types";
import type { ImportedToolDeps } from "@/packages/query-tools/imported-tools";
import type { QueryToolPorts } from "@/packages/query-tools/ports";
import type { SessionScope } from "@/packages/query-tools/scope";

import type { ChatRequest } from "./chat-request";
import { createChatTools, forSkill, forSources } from "./chat-tools";
import { finishModelResponse } from "./finish-model-response";
import type { GenerationFacts } from "./generation-analytics";
import { guardGenomeHistory } from "./genome-history-guard";
import type { GenomeToolDeps } from "./genome-tools";
import { errorNameOf, modelFailureLog } from "./model-failure-log";
import type { ResponseDocumentV1, ResponseToolCall } from "./response/document-v1";
import { chatResponseMetadata } from "./response-document";
import { runTwinTurn } from "./run-twin-turn";
import type { ThreadView } from "./thread-views";
import { twinUIMessageResponse } from "./twin-ui-stream";
import type { ModelResponseCompleteParams } from "./write-model-response-complete";

/**
 * One model's answer, streamed to the browser, with where it is kept and who
 * hears about it passed in as ports. A saved chat (`stream-model-response.ts`)
 * binds the database rows and analytics; an incognito chat
 * (`incognito-answer.ts`) binds ports that keep and report nothing. The model
 * call, tools, data-mode policy, skill rules and genome history guard are the
 * same code for both, so the two cannot drift apart.
 *
 * `runTwinTurn` (shared with the eval harness) owns the model call itself:
 * prompt, tools, step limit, parsing and the response document. This module
 * wraps it with the browser stream, the answer store and analytics.
 *
 * The final metadata (metrics plus response document) is sent only after the
 * document has been built from this turn's audit rows, so the browser never
 * sees a document from a half-read audit. Until then the UI stream holds its
 * finish chunk and keeps the connection alive with heartbeats. If the browser
 * leaves, the turn still finishes and is stored (when the store keeps it), so a
 * reload shows it.
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
  /**
   * Set when the answer's model id is an agent (`agent:<id>`): the model
   * called is its base model, and its role line joins the system prompt.
   */
  agent?: CatalogAgent | null;
}>;

type RowTarget = Readonly<{ turnId: string; modelId: string }>;

/** Where an answer is kept. Every write is keyed by the turn id and model. */
export type AnswerStore = Readonly<{
  writeComplete: (params: ModelResponseCompleteParams) => Promise<unknown>;
  writeFailed: (target: RowTarget) => Promise<unknown>;
  markRefused: (target: RowTarget & Readonly<{ sentence: string }>) => Promise<void>;
  /** The views the turn's thread already showed, for `list_views` and `open_view`. */
  loadViews: (turnId: string) => Promise<readonly ThreadView[]>;
}>;

export type AnsweredFacts = Readonly<{
  clerkId: string;
  turnId: string;
  modelId: string;
  status: "COMPLETE" | "FAILED";
}>;

/** Who hears that an answer finished. Neither port ever gets prompt or answer text. */
export type AnswerAnalytics = Readonly<{
  answered: (facts: AnsweredFacts) => void;
  generation: (facts: GenerationFacts) => Promise<void>;
}>;

export type StreamModelResponseDeps = Readonly<{
  settings: () => Readonly<{ dataMode: DataMode; provider: LlmProvider }>;
  /** True when the chat model runs on this machine (Ollama on loopback). */
  chatIsLocal: () => boolean;
  resolveModel: (
    modelId: string,
    options: Readonly<{ hasWearableNarrative: boolean }>,
  ) => LanguageModel;
  /** Genome tool ports, or undefined when the genome policy does not allow them. */
  genomeTools: (scope: SessionScope) => GenomeToolDeps | undefined;
  /** The imported-data tools' ports, or undefined when the policy refuses this turn. */
  importedTools: (scope: SessionScope) => ImportedToolDeps | undefined;
  /** Audit rows of the turn's session, read once the model has finished. */
  loadAudit: (sessionId: string) => Promise<readonly ResponseToolCall[]>;
  store: AnswerStore;
  analytics: AnswerAnalytics;
  /** Query tool ports; left out, the tools use the warehouse. Tests pass fakes. */
  query?: QueryToolPorts;
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

export const createStreamModelResponse =
  (deps: StreamModelResponseDeps) =>
  async (request: ChatRequest, context: StreamContext): Promise<Response> => {
    const { modelId, turnId, messages } = request;
    const { clerkId } = context;
    const held = await guardGenomeHistory(
      { chatIsLocal: deps.chatIsLocal, markRefused: deps.store.markRefused },
      request,
      context.genomeThread,
    );
    if (held !== null) return held;

    const settings = deps.settings();
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
    const scope = { actor: clerkId, sessionId: turnId, mode: settings.dataMode };
    const { tools, offeredTools } = forSkill(
      forSources(
        createChatTools(scope, {
          query: deps.query,
          hasWearableNarrative,
          wearables: turnWearables,
          disabledSources: context.disabledSources,
          views: skill?.views,
          sources: skill?.sources,
          loadViews: deps.store.loadViews,
          genome: deps.genomeTools(scope),
          imported: deps.importedTools(scope),
          agent: context.agent?.id ?? null,
        }),
        context.disabledSources ?? [],
      ).tools,
      skill,
    );

    const logStep = (step: string) => (error: unknown) =>
      console.error(`[chat] ${modelId} ${step}`, errorNameOf(error));

    const turn = runTwinTurn(
      {
        model: deps.resolveModel(context.agent?.baseModelId ?? modelId, {
          hasWearableNarrative,
        }),
        tools,
        offeredTools,
        mode: settings.dataMode,
        skill,
        uiContext: request.uiContext ?? null,
        agent: context.agent ?? null,
        loadAudit: deps.loadAudit,
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
              writeComplete: async (document) => {
                await deps.store.writeComplete({
                  turnId,
                  modelId,
                  text,
                  metrics,
                  reasoningText: parsed.reasoningText,
                  attribution: parsed.attribution,
                  document,
                  toolResults,
                });
              },
              writeFailed: async () => {
                await deps.store.writeFailed({ turnId, modelId });
              },
              logError: (message, name) =>
                console.error(`[chat] ${modelId} ${message}`, name),
            });
            // Ends the browser stream; metadata goes out only with a document.
            outcome.settle(
              finished.document === null
                ? null
                : { metrics, document: finished.document },
            );
            deps.analytics.answered({
              clerkId,
              turnId,
              modelId,
              status: finished.status,
            });
            await deps.analytics
              .generation({
                mode: settings.dataMode,
                distinctId: clerkId,
                provider: settings.provider,
                modelId,
                turnId,
                metrics,
                attributionCount: parsed.attribution.length,
                hallucinatedKeyCount: parsed.hallucinatedKeys.length,
                contextSources: sources,
              })
              .catch(logStep("analytics capture failed"));
          } finally {
            // Only matters when something above threw: the stream must still end.
            outcome.settle(null);
          }
        },
        onError: async (error) => {
          console.error(`[chat] model ${modelId} failed`, modelFailureLog(error));
          await deps.store
            .writeFailed({ turnId, modelId })
            .catch(logStep("could not record the answer as failed"));
          deps.analytics.answered({ clerkId, turnId, modelId, status: "FAILED" });
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
