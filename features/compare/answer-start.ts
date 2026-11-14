import type { ChatRequest } from "@/features/chat/chat-request";
import type { RunningAnswer } from "@/features/chat/running-answers";
import { createStartAnswer, type StartAnswerDeps } from "@/features/chat/start-answer";
import type { CatalogAgent } from "@/infrastructure/model-catalog";
import type { ModelResponseStatus } from "@/generated/prisma/client";

/**
 * One answer's start, shared by `POST /api/chat` and a scheduled run
 * (SERVER-SPEC 3.4), so both go through the same permits, audit rows and
 * ledger. Two decisions on top of `features/chat/start-answer.ts`:
 *
 * - A refusal whose sentence cannot be stored is logged by error name and
 *   still goes out; a reload then asks again rather than show nothing.
 * - Anything that throws before the stream has started (an audit row that
 *   must exist before the model is called, a note load, the stream setup)
 *   ends the answer row as FAILED, so a reload shows a failed column instead
 *   of opening a stream against a row nothing will ever finish. The error is
 *   thrown on to the caller, which answers with its fixed sentence.
 */

export type AnswerStartDeps = StartAnswerDeps &
  Readonly<{
    markFailed: (target: Readonly<{ turnId: string; modelId: string }>) => Promise<void>;
    logError: (message: string, errorName: string) => void;
  }>;

const nameOf = (error: unknown): string =>
  error instanceof Error ? error.name : "unknown";

export const createAnswerStart = (deps: AnswerStartDeps) => {
  const start = createStartAnswer({
    ...deps,
    markRefused: async (target) => {
      await deps.markRefused(target).catch((error: unknown) => {
        deps.logError("could not store the refusal", nameOf(error));
      });
    },
  });
  return async (
    actorId: string,
    appUserId: string,
    call: ChatRequest,
    agent: CatalogAgent | null = null,
    model: Readonly<{ canThink: boolean }> = { canThink: false },
    stop: RunningAnswer | null = null,
  ): Promise<Response> => {
    try {
      return await start(actorId, appUserId, call, agent, model, stop);
    } catch (error) {
      await deps
        .markFailed({ turnId: call.turnId, modelId: call.modelId })
        .catch((markError: unknown) => {
          deps.logError("could not mark the answer failed", nameOf(markError));
        });
      throw error;
    }
  };
};

/** The sentence `/api/chat` answers a request for a finished answer with. */
export const ANSWER_FINISHED_SENTENCE =
  "That answer has already finished. Reload the thread to read it.";

/**
 * Whether an answer row may be asked for again. A finished answer stays as
 * stored; a failed, refused or stopped one may be retried ("Try again"), and
 * a row still marked as streaming may be read again after a reload.
 */
export const answerMayStart = (status: ModelResponseStatus): boolean =>
  status !== "COMPLETE";
