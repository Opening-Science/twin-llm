import { answerOwnership } from "@/features/chat/answer-ownership";
import {
  chatRequestSchema,
  type ChatRequest,
  currentPrompt,
} from "@/features/chat/chat-request";
import { startAnswer } from "@/features/arena/answer-runtime";
import { guardChatRequest } from "@/features/chat/chat-protection";
import { publicProviderFailure } from "@/features/chat/public-provider-failure";
import { runningAnswers } from "@/features/chat/running-answers";
import { runnableSkills } from "@/features/skills/load-skills";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { isAuthDisabled, serverEnv } from "@/infrastructure/env";
import { fetchChatCatalog } from "@/infrastructure/fetch-model-catalog";
import {
  findCatalogRow,
  modelCanThink,
  turnAgentOf,
} from "@/infrastructure/model-catalog";
import { withUnlocked } from "@/infrastructure/vault-runtime";

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
 *
 * The answer is listed as running from here on, so `POST /api/chat/stop` can
 * end it (#373). Closing this request does not: the browser going away leaves
 * the answer to finish and be stored.
 */

const refuse = (status: number, error: string): Response =>
  Response.json({ error }, { status });

const readBody = async (request: Request): Promise<ChatRequest | null> => {
  const body: unknown = await request.json().catch(() => null);
  const parsed = chatRequestSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
};

export const POST = withUnlocked(async (request: Request): Promise<Response> => {
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
  if (findCatalogRow(call.modelId, models) === null) {
    return refuse(
      400,
      serverEnv().LLM_PROVIDER === "openrouter"
        ? "That model isn't one of the free models TwinLLM offers."
        : "That model isn't available for the active LLM provider.",
    );
  }

  const ownership = await answerOwnership(actorId, call);
  if (ownership.kind === "missing") {
    return refuse(400, "That turn hasn't been started for this model.");
  }
  if (ownership.kind === "someone-else")
    return refuse(403, "That turn isn't yours to answer.");

  const agent = turnAgentOf(
    call.modelId,
    models,
    currentPrompt(call.messages),
    ownership.modelName,
  );
  const running = runningAnswers().start(call);
  try {
    const response = await startAnswer(
      actorId,
      ownership.appUserId,
      call,
      agent,
      { canThink: modelCanThink(agent?.baseModelId ?? call.modelId, models) },
      running,
    );
    // A refusal ran no model; a stream takes itself off the list when it ends.
    if (response.status !== 200) running.release();
    return response;
  } catch (error) {
    running.release();
    console.error(
      "[chat] failed to start the model stream",
      publicProviderFailure(error),
    );
    return refuse(502, "We couldn't reach that model just now. Give it another try.");
  }
});
