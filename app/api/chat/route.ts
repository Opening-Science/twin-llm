import {
  chatRequestSchema,
  type ChatRequest,
  currentPrompt,
} from "@/features/chat/chat-request";
import { guardChatRequest } from "@/features/chat/chat-protection";
import { loadGenomeThread } from "@/features/chat/load-genome-thread";
import { publicProviderFailure } from "@/features/chat/public-provider-failure";
import { markModelResponseRefused } from "@/features/chat/persist-model-response";
import { createStartAnswer } from "@/features/chat/start-answer";
import { streamModelResponse } from "@/features/chat/stream-model-response";
import { loadWearableContext } from "@/features/chat/wearable-context";
import { getLatestGoogleHealthSummary } from "@/features/google-health/connection";
import { notesBeforeThread } from "@/features/memory/note-store";
import { loadDisabledSources } from "@/features/onboarding/onboarding-store";
import { getLatestOuraSummary } from "@/features/oura/connection";
import { findSkillFor } from "@/features/skills/user-skill-store";
import { getLatestVitronicSummary } from "@/features/vitronic/connection";
import { getLatestWhoopSummary } from "@/features/whoop/connection";
import { runnableSkills } from "@/features/skills/load-skills";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { findAppUserId } from "@/infrastructure/current-user";
import { database } from "@/infrastructure/database";
import { exoscalePersonalData, isAuthDisabled, serverEnv } from "@/infrastructure/env";
import { fetchChatCatalog } from "@/infrastructure/fetch-model-catalog";
import { chatModelIsLocal } from "@/infrastructure/genome-gate";
import { turnAgentOf } from "@/infrastructure/model-catalog";
import { append } from "@/packages/audit/append";

/**
 * Starts one model's answer for an existing turn.
 *
 * Each selected model gets its own request, so answers stream and fail
 * independently. Before any model is called the request must: come from a
 * known person, pass abuse protection (auth on only), be well formed, name a
 * model the active provider offers (or an agent over one, `agent:<id>`), and
 * target a turn this person owns. Auto (`agent:auto`) runs as the agent its
 * column names, which the turn stored when it started. Every
 * refusal is a plain sentence; internal errors stay in the server log.
 */

const refuse = (status: number, error: string): Response =>
  Response.json({ error }, { status });

const readBody = async (request: Request): Promise<ChatRequest | null> => {
  const body: unknown = await request.json().catch(() => null);
  const parsed = chatRequestSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
};

type Ownership =
  | Readonly<{ kind: "owner"; appUserId: string; modelName: string }>
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "someone-else" }>;

/** The turn's thread must belong to the person making the call. */
const ownershipOf = async (actorId: string, call: ChatRequest): Promise<Ownership> => {
  const row = await database().modelResponse.findUnique({
    where: { turnId_modelId: { turnId: call.turnId, modelId: call.modelId } },
    select: {
      modelName: true,
      turn: { select: { thread: { select: { userId: true } } } },
    },
  });
  if (row === null) return { kind: "missing" };
  const appUserId = await findAppUserId(actorId);
  return appUserId !== null && row.turn.thread.userId === appUserId
    ? { kind: "owner", appUserId, modelName: row.modelName }
    : { kind: "someone-else" };
};

const startAnswer = createStartAnswer({
  settings: () => {
    const env = serverEnv();
    return {
      dataMode: env.DATA_MODE,
      provider: env.LLM_PROVIDER,
      exoscalePersonalData: exoscalePersonalData(env),
    };
  },
  chatIsLocal: chatModelIsLocal,
  loadGenomeThread,
  loadWearables: (mode, appUserId) =>
    loadWearableContext(mode, appUserId, {
      oura: getLatestOuraSummary,
      whoop: getLatestWhoopSummary,
      googleHealth: getLatestGoogleHealthSummary,
      vitronic: getLatestVitronicSummary,
    }),
  loadDisabledSources,
  appendAudit: (input) => append(database(), input),
  findSkill: findSkillFor,
  loadTwinNotes: notesBeforeThread,
  stream: streamModelResponse,
  // The person still gets the refusal when the row cannot be written; a
  // reload then asks again, which is how a refused turn behaved before.
  markRefused: (target) =>
    markModelResponseRefused(target).catch((error: unknown) => {
      console.error(
        "[chat] could not store the refusal",
        error instanceof Error ? error.name : "unknown",
      );
    }),
});

export const POST = async (request: Request): Promise<Response> => {
  const actorId = await resolveActorId();
  if (!actorId) return refuse(401, "Sign in to send a prompt to TwinLLM.");

  const throttled = isAuthDisabled() ? null : await guardChatRequest(request, actorId);
  if (throttled !== null) return throttled;

  const call = await readBody(request);
  if (call === null) {
    return refuse(400, "That request didn't look right. Try sending your prompt again.");
  }

  const models = await fetchChatCatalog(runnableSkills());
  if (models === null) {
    return refuse(503, "We can't reach the model list right now. Try again in a moment.");
  }
  if (!models.some(({ id }) => id === call.modelId)) {
    return refuse(
      400,
      serverEnv().LLM_PROVIDER === "openrouter"
        ? "That model isn't one of the free models TwinLLM offers."
        : "That model isn't available for the active LLM provider.",
    );
  }

  const ownership = await ownershipOf(actorId, call);
  if (ownership.kind === "missing") {
    return refuse(400, "That turn hasn't been started for this model.");
  }
  if (ownership.kind === "someone-else")
    return refuse(403, "That turn isn't yours to answer.");

  try {
    return await startAnswer(
      actorId,
      ownership.appUserId,
      call,
      turnAgentOf(
        call.modelId,
        models,
        currentPrompt(call.messages),
        ownership.modelName,
      ),
    );
  } catch (error) {
    console.error(
      "[chat] failed to start the model stream",
      publicProviderFailure(error),
    );
    return refuse(502, "We couldn't reach that model just now. Give it another try.");
  }
};
