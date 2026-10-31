import type { ChatRequest } from "@/features/chat/chat-request";
import {
  type CatalogAgent,
  type CatalogModel,
  turnAgentOf,
} from "@/infrastructure/model-catalog";

import { checkTurnRequest, type TurnPlan } from "./turn-rules";
import type { StartTurnResult } from "./write-turn";

/**
 * A scheduled task's run (#54) as a typed turn: the same turn check, the
 * same nested write (marked `scheduled`), then the same `startAnswer` the
 * chat route calls, with a request shaped exactly like the browser's for
 * `/skill question`. Nothing here decides a permit: the provider, skill,
 * genome and data-mode rules, the audit rows and the disclosure ledger all
 * happen inside `startAnswer`, as for a typed turn.
 *
 * The run sends only its own question, not the thread's earlier turns, so
 * each run reads the data as it is that day. The answer stream is read to
 * its end on the server; the answer row then holds the outcome.
 */

export type ScheduledTurnInput = Readonly<{
  actorId: string;
  appUserId: string;
  /** Null starts a new thread. */
  threadId: string | null;
  skill: string;
  question: string;
  modelId: string;
}>;

export type ScheduledTurnStatus = "complete" | "failed" | "refused";

export type ScheduledTurnOutcome = Readonly<{
  status: ScheduledTurnStatus;
  turnId: string | null;
  threadId: string | null;
}>;

export type ScheduledTurnDeps = Readonly<{
  provider: () => string;
  catalog: () => Promise<readonly CatalogModel[] | null>;
  writeTurn: (
    ownerId: string,
    threadId: string | null,
    plan: TurnPlan,
    options: Readonly<{ scheduled: boolean }>,
  ) => Promise<StartTurnResult>;
  startAnswer: (
    actorId: string,
    appUserId: string,
    call: ChatRequest,
    agent: CatalogAgent | null,
  ) => Promise<Response>;
  /** Marks the answer failed when the stream could not start at all. */
  markFailed: (target: Readonly<{ turnId: string; modelId: string }>) => Promise<unknown>;
  /** The answer row's status once the stream has ended. */
  answerStatus: (turnId: string, modelId: string) => Promise<string | null>;
  logError: (message: string, error: unknown) => void;
}>;

const statusOf = (stored: string | null): ScheduledTurnStatus =>
  stored === "COMPLETE" ? "complete" : stored === "REFUSED" ? "refused" : "failed";

/** Reads a response body to its end; the answer is stored as the stream finishes. */
const drain = async (response: Response): Promise<void> => {
  if (response.body === null) return;
  const reader = response.body.getReader();
  for (;;) {
    const { done } = await reader.read();
    if (done) return;
  }
};

export const createScheduledTurn =
  (deps: ScheduledTurnDeps) =>
  async (input: ScheduledTurnInput): Promise<ScheduledTurnOutcome> => {
    const failed = (threadId: string | null): ScheduledTurnOutcome => ({
      status: "failed",
      turnId: null,
      threadId,
    });
    const catalog = await deps.catalog();
    const checked = checkTurnRequest(
      { prompt: input.question, modelIds: [input.modelId], skill: input.skill },
      catalog,
      deps.provider(),
    );
    if (!checked.ok || catalog === null) return failed(input.threadId);

    const written = await deps.writeTurn(input.appUserId, input.threadId, checked.plan, {
      scheduled: true,
    });
    if (!written.ok) return failed(input.threadId);
    const column = written.responses[0];
    if (column === undefined) return failed(written.threadId);

    const call: ChatRequest = {
      modelId: input.modelId,
      turnId: written.turnId,
      messages: [{ role: "user", content: checked.plan.prompt }],
      skill: input.skill,
    };
    try {
      const response = await deps.startAnswer(
        input.actorId,
        input.appUserId,
        call,
        turnAgentOf(input.modelId, catalog, checked.plan.prompt, column.modelName),
      );
      await drain(response);
    } catch (error) {
      deps.logError("scheduled turn did not start", error);
      await deps
        .markFailed({ turnId: written.turnId, modelId: input.modelId })
        .catch((failure: unknown) => deps.logError("could not mark the answer", failure));
    }
    const stored = await deps.answerStatus(written.turnId, input.modelId);
    return {
      status: statusOf(stored),
      turnId: written.turnId,
      threadId: written.threadId,
    };
  };
