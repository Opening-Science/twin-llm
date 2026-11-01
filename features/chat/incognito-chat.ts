import { incognitoSessionId, permitIncognitoModel } from "@/infrastructure/incognito";
import type { DataMode } from "@/infrastructure/data-mode-policy";
import {
  type CatalogAgent,
  findCatalogRow,
  modelCanThink,
  turnAgentOf,
} from "@/infrastructure/model-catalog";
import type { KnowledgeSourceId } from "@/infrastructure/knowledge-sources";
import type { TurnSkill } from "@/infrastructure/skill-gate";
import type { AppendInput } from "@/packages/audit/append";

import {
  type ChatRequest,
  currentPrompt,
  type IncognitoChatRequest,
  incognitoChatRequestSchema,
} from "./chat-request";
import {
  type AnswerAnalytics,
  type AnswerStore,
  createStreamModelResponse,
  type StreamModelResponseDeps,
} from "./create-stream-model-response";
import { publicProviderFailure } from "./public-provider-failure";
import { type ChatProviderSettings, createStartAnswer } from "./start-answer";
import type { WearableContext } from "./wearable-context";

/**
 * `POST /api/chat/incognito`: one model's answer for a conversation that is
 * never saved (`infrastructure/incognito.ts`). A factory, so the route wires
 * the real reads and tests pass fakes.
 *
 * It is the saved chat's pipeline with nothing kept: the same provider check,
 * skill and genome rules (`createStartAnswer`) and the same model, tools and
 * stream (`createStreamModelResponse`), with an answer store that writes
 * nothing and analytics that send nothing. The store and analytics are fixed
 * here, not passed in, so no wiring can make an incognito answer persist.
 *
 * Before any model is called the request must come from a signed-in person,
 * pass abuse protection, be a well-formed closed body, and the chat model must
 * run on this machine (`INCOGNITO_LOCAL_ONLY` otherwise) and be one the
 * provider offers. Each answer gets a random audit session id; tool reads are
 * audited under it as usual (tool, subject, row count, time and hashes; the
 * chain stores no text), and no thread or turn id exists to link it to.
 *
 * Prompt and answer text never reach a log line: failures log the error's
 * name and an allowlisted provider code only.
 */

/** Keeps nothing: every write is dropped and no earlier views exist. */
export const INCOGNITO_ANSWER_STORE: AnswerStore = Object.freeze({
  writeComplete: async () => undefined,
  writeFailed: async () => undefined,
  markRefused: async () => undefined,
  loadViews: async () => [],
});

/** Sends nothing: no funnel event, no generation event. */
export const INCOGNITO_ANALYTICS: AnswerAnalytics = Object.freeze({
  answered: () => undefined,
  generation: async () => undefined,
});

const NO_WEARABLES: WearableContext = {
  ouraSummary: null,
  whoopSummary: null,
  googleHealthSummary: null,
  vitronicSummary: null,
};

export type IncognitoChatDeps = Readonly<{
  resolveActorId: () => Promise<string | null>;
  /** Abuse protection; null when the call may proceed (auth off: always null). */
  guard: (request: Request, actorId: string) => Promise<Response | null>;
  /**
   * Model ids the active provider offers, agents included, or null when the
   * list is unreachable.
   */
  catalog: () => Promise<
    readonly Readonly<{ id: string; agent?: CatalogAgent }>[] | null
  >;
  /** True when the chat model runs on this machine (Ollama on loopback). */
  chatIsLocal: () => boolean;
  /** The person's app user id; reads only, never creates one. */
  findAppUserId: (actorId: string) => Promise<string | null>;
  settings: () => ChatProviderSettings;
  loadWearables: (mode: DataMode, appUserId: string) => Promise<WearableContext>;
  loadDisabledSources: (appUserId: string) => Promise<readonly KnowledgeSourceId[]>;
  appendAudit: (input: AppendInput) => Promise<unknown>;
  findSkill: (name: string, appUserId: string) => Promise<TurnSkill | null>;
  randomId: () => string;
  /** The model and tool ports of the shared pipeline; store and analytics are fixed above. */
  pipeline: Omit<
    StreamModelResponseDeps,
    "settings" | "chatIsLocal" | "store" | "analytics"
  >;
}>;

const refuse = (status: number, error: string): Response =>
  Response.json({ error }, { status });

const readBody = async (request: Request): Promise<IncognitoChatRequest | null> => {
  const body: unknown = await request.json().catch(() => null);
  const parsed = incognitoChatRequestSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
};

export const createIncognitoChatHandler = (deps: IncognitoChatDeps) => {
  const stream = createStreamModelResponse({
    ...deps.pipeline,
    settings: () => {
      const settings = deps.settings();
      return { dataMode: settings.dataMode, provider: settings.provider };
    },
    chatIsLocal: deps.chatIsLocal,
    store: INCOGNITO_ANSWER_STORE,
    analytics: INCOGNITO_ANALYTICS,
    // Nothing may leave an incognito chat: no live public lookup (#6).
    incognito: true,
  });

  return async (request: Request): Promise<Response> => {
    const actorId = await deps.resolveActorId();
    if (!actorId) return refuse(401, "Sign in to send a prompt to TwinLLM.");

    const throttled = await deps.guard(request, actorId);
    if (throttled !== null) return throttled;

    const body = await readBody(request);
    if (body === null) {
      return refuse(
        400,
        "That request didn't look right. Try sending your prompt again.",
      );
    }

    const permit = permitIncognitoModel({ chatIsLocal: deps.chatIsLocal() });
    if (!permit.ok) {
      return Response.json({ code: permit.code, error: permit.error }, { status: 400 });
    }

    const models = await deps.catalog();
    if (models === null) {
      return refuse(
        503,
        "We can't reach the model list right now. Try again in a moment.",
      );
    }
    if (findCatalogRow(body.modelId, models) === null) {
      return refuse(400, "That model isn't available for the active LLM provider.");
    }

    const sessionId = incognitoSessionId(deps.randomId);
    const appUserId = await deps.findAppUserId(actorId);
    const startAnswer = createStartAnswer({
      settings: deps.settings,
      chatIsLocal: deps.chatIsLocal,
      // Nothing was stored, so the thread is this answer alone; the history
      // check in `createStartAnswer` still reads the messages sent.
      loadGenomeThread: async () => ({ threadId: sessionId, usedGenome: false }),
      loadWearables: (mode) =>
        appUserId === null
          ? Promise.resolve(NO_WEARABLES)
          : deps.loadWearables(mode, appUserId),
      loadDisabledSources: () =>
        appUserId === null ? Promise.resolve([]) : deps.loadDisabledSources(appUserId),
      appendAudit: deps.appendAudit,
      findSkill: deps.findSkill,
      stream,
      markRefused: INCOGNITO_ANSWER_STORE.markRefused,
    });
    const call: ChatRequest = { ...body, turnId: sessionId };

    const agent = turnAgentOf(body.modelId, models, currentPrompt(body.messages));
    try {
      return await startAnswer(actorId, appUserId ?? "", call, agent, {
        canThink: modelCanThink(agent?.baseModelId ?? body.modelId, models),
      });
    } catch (error) {
      console.error(
        "[chat] failed to start the incognito model stream",
        error instanceof Error ? error.name : "unknown",
        publicProviderFailure(error),
      );
      return refuse(502, "We couldn't reach that model just now. Give it another try.");
    }
  };
};
