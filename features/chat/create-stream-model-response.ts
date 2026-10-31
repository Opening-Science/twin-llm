import type { LanguageModel } from "ai";

import type { AppliedEffort } from "@/infrastructure/chat-effort";
import type { DataMode, LlmProvider } from "@/infrastructure/data-mode-policy";
import type { GoogleHealthSummary } from "@/infrastructure/google-health-types";
import type { KnowledgeSourceId } from "@/infrastructure/knowledge-sources";
import type { LiveSourceId } from "@/infrastructure/live-sources";
import type { CatalogAgent } from "@/infrastructure/model-catalog";
import {
  type ChatUIMessage,
  createResponseTimer,
  type ModelResponseMetrics,
} from "@/infrastructure/model-response-metrics";
import type { OuraSummary } from "@/infrastructure/oura-types";
import type { TurnSkill } from "@/infrastructure/skill-gate";
import { splitThinking } from "@/infrastructure/think-block";
import type { TwinNote } from "@/infrastructure/twin-notes";
import type { VitronicSummary } from "@/infrastructure/vitronic-types";
import type { WhoopSummary } from "@/infrastructure/whoop-types";
import type {
  ModelDisclosure,
  UnrecordedModelCall,
} from "@/infrastructure/disclosure-ledger";
import type { ImportedToolDeps } from "@/packages/query-tools/imported-tools";
import type { GenomeVariantsDeps } from "@/packages/query-tools/imported-variants";
import type { QueryToolPorts } from "@/packages/query-tools/ports";
import type { SessionScope } from "@/packages/query-tools/scope";

import { chatDisclosure, numberReviewDisclosure } from "./chat-disclosure";
import type { ChatRequest } from "./chat-request";
import { createTurnTools } from "./chat-tools";
import { finishModelResponse } from "./finish-model-response";
import type { GenerationFacts } from "./generation-analytics";
import { guardGenomeHistory } from "./genome-history-guard";
import type { GenomeToolDeps } from "./genome-tools";
import { errorNameOf, modelFailureLog } from "./model-failure-log";
import type { ResponseDocumentV1, ResponseToolCall } from "./response/document-v1";
import { chatResponseMetadata } from "./response-document";
import { runNumberReview } from "./run-number-review";
import { runTwinTurn } from "./run-twin-turn";
import type { ThreadView } from "./thread-views";
import { fitTwinNotes } from "./twin-notes-room";
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
  /** The saved thread, for the disclosure ledger (#140); null for an incognito chat. */
  threadId?: string | null;
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
  /**
   * Live public lookups (#6) this user switched on. Left out, none: an
   * incognito chat and local-only mode never set it.
   */
  liveSources?: readonly LiveSourceId[];
  /** The skill this turn runs under, already permitted by `start-answer`. */
  skill?: TurnSkill | null;
  /**
   * Set when the answer's model id is an agent (`agent:<id>`): the model
   * called is its base model, and its role line joins the system prompt.
   */
  agent?: CatalogAgent | null;
  /**
   * The twin notes this turn may carry (#43), already filtered by data mode
   * and permit by `start-answer`. Incognito chats never set it.
   */
  twinNotes?: TwinNotesOffer | null;
  /**
   * The effort this answer runs at (#366), already applied to its model and
   * audited by `start-answer`. Left out, Balanced as before.
   */
  effort?: AppliedEffort | null;
}>;

/**
 * Notes a turn may carry and how their load is audited. The turn keeps as
 * many as its prompt room allows (`fitTwinNotes`) and records those ids
 * before the model is called; if that write fails, the model is not called.
 */
export type TwinNotesOffer = Readonly<{
  notes: readonly TwinNote[];
  recordLoad: (ids: readonly string[]) => Promise<void>;
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
  /**
   * The model, sending through the disclosure ledger (#140): `disclosure`
   * says what the turn's requests carry.
   */
  resolveModel: (
    modelId: string,
    options: Readonly<{
      hasWearableNarrative: boolean;
      disclosure: ModelDisclosure | UnrecordedModelCall;
    }>,
  ) => LanguageModel;
  /** Genome tool ports, or undefined when the genome policy does not allow them. */
  genomeTools: (scope: SessionScope) => GenomeToolDeps | undefined;
  /** `genome_variants` ports, or undefined when the VCF permit does not allow them (#330). */
  variantTools: (scope: SessionScope) => GenomeVariantsDeps | undefined;
  /** The imported-data tools' ports, or undefined when the policy refuses this turn. */
  importedTools: (scope: SessionScope) => ImportedToolDeps | undefined;
  /** Audit rows of the turn's session, read once the model has finished. */
  loadAudit: (sessionId: string) => Promise<readonly ResponseToolCall[]>;
  store: AnswerStore;
  analytics: AnswerAnalytics;
  /** Query tool ports; left out, the tools use the warehouse. Tests pass fakes. */
  query?: QueryToolPorts;
  /** An incognito chat: no live lookup is offered or sent, whatever the context says. */
  incognito?: boolean;
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
    const genome = deps.genomeTools(scope);
    const variants = deps.variantTools(scope);
    const { tools, offeredTools } = createTurnTools(
      scope,
      {
        query: deps.query,
        hasWearableNarrative,
        wearables: turnWearables,
        disabledSources: context.disabledSources,
        loadViews: deps.store.loadViews,
        genome,
        variants,
        imported: deps.importedTools(scope),
        agent: context.agent?.id ?? null,
        live: {
          enabled: context.liveSources ?? [],
          incognito: deps.incognito ?? false,
          genomeInTurn: genome !== undefined || variants !== undefined,
        },
      },
      skill,
    );

    const promptDeps = {
      tools,
      offeredTools,
      mode: settings.dataMode,
      skill,
      uiContext: request.uiContext ?? null,
      agent: context.agent ?? null,
    };
    const offer = context.twinNotes ?? null;
    const notes =
      offer === null ? null : await fitTwinNotes(promptDeps, turnWearables, offer.notes);
    if (offer !== null && notes !== null && notes.ids.length > 0) {
      await offer.recordLoad(notes.ids);
    }

    const logStep = (step: string) => (error: unknown) =>
      console.error(`[chat] ${modelId} ${step}`, errorNameOf(error));

    const calledModelId = context.agent?.baseModelId ?? modelId;
    const disclosure = chatDisclosure({
      actor: clerkId,
      turnId,
      threadId: context.threadId ?? null,
      mode: settings.dataMode,
      messageCount: messages.length,
      wearables: turnWearables,
      noteIds: notes?.ids ?? [],
      hasTools: Object.keys(tools).length > 0,
    });
    const effort = context.effort ?? null;
    const reviewing = settleOnce<boolean>();

    const turn = runTwinTurn(
      {
        model: deps.resolveModel(calledModelId, { hasWearableNarrative, disclosure }),
        ...promptDeps,
        twinNotes: notes?.text ?? null,
        loadAudit: deps.loadAudit,
        effort,
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
              // At Ultra the number check runs on the finished answer and joins
              // its document; below Ultra the document is built as it was.
              buildDocument: async () => {
                const document = await buildDocument();
                if (effort?.review !== true) return document;
                reviewing.settle(true);
                const review = await runNumberReview(
                  deps.resolveModel(calledModelId, {
                    hasWearableNarrative,
                    disclosure: numberReviewDisclosure(disclosure),
                  }),
                  splitThinking(text).text,
                  toolResults,
                );
                return { ...document, number_review: review };
              },
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
            reviewing.settle(false);
            outcome.settle(null);
          }
        },
        onError: async (error) => {
          console.error(`[chat] model ${modelId} failed`, modelFailureLog(error));
          await deps.store
            .writeFailed({ turnId, modelId })
            .catch(logStep("could not record the answer as failed"));
          deps.analytics.answered({ clerkId, turnId, modelId, status: "FAILED" });
          reviewing.settle(false);
          outcome.settle(null);
        },
        onAbort: () => {
          reviewing.settle(false);
          outcome.settle(null);
        },
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
      reviewing: reviewing.promise,
      onError: failureText,
    });
  };
