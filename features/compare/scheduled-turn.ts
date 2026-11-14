import type { ChatRequest } from "@/features/chat/chat-request";
import type { TaskTurnOutcome } from "@/features/tasks/run-task";
import {
  type CatalogAgent,
  type CatalogModel,
  turnAgentOf,
} from "@/infrastructure/model-catalog";

import type { StartTurnResult } from "./start-turn-result";
import { planTurn, type TurnPlan } from "./turn-plan";

/**
 * A scheduled task's turn (SERVER-SPEC 3.5): the typed turn's pipeline with
 * no browser. The scheduler has already checked the vault, written its
 * `task.run` row and opened the question. Here: the same plan check and
 * turn writer as a typed turn (marked scheduled), a request shaped exactly
 * like the browser's for `/skill question` with no earlier turns, the same
 * answer start with no stop handle, read to its end on the server. No abuse
 * protection and no `prompt_sent` event.
 */

export type ScheduledTurnInput = Readonly<{
  actorId: string;
  appUserId: string;
  threadId: string | null;
  skill: string;
  question: string;
  modelId: string;
}>;

export type StoredStatus = "STREAMING" | "COMPLETE" | "FAILED" | "REFUSED" | "STOPPED";

export type ScheduledTurnDeps = Readonly<{
  catalog: () => Promise<readonly CatalogModel[] | null>;
  provider: () => string;
  writeTurn: (
    input: Readonly<{
      ownerId: string;
      threadId: string | null;
      plan: TurnPlan;
      scheduled: true;
    }>,
  ) => Promise<StartTurnResult>;
  startAnswer: (
    actorId: string,
    appUserId: string,
    call: ChatRequest,
    agent: CatalogAgent | null,
  ) => Promise<Response>;
  markFailed: (target: Readonly<{ turnId: string; modelId: string }>) => Promise<void>;
  storedStatus: (
    target: Readonly<{ turnId: string; modelId: string }>,
  ) => Promise<StoredStatus | null>;
  logError: (message: string, detail: unknown) => void;
}>;

const outcomeOf = (status: StoredStatus | null): TaskTurnOutcome["status"] =>
  status === "COMPLETE" ? "complete" : status === "REFUSED" ? "refused" : "failed";

const drain = async (response: Response): Promise<void> => {
  const reader = response.body?.getReader();
  if (reader === undefined) return;
  for (;;) {
    const { done } = await reader.read();
    if (done) return;
  }
};

export const createScheduledTurn =
  (deps: ScheduledTurnDeps) =>
  async (input: ScheduledTurnInput): Promise<TaskTurnOutcome> => {
    const failed = (threadId: string | null, turnId: string | null = null) => ({
      status: "failed" as const,
      turnId,
      threadId,
    });
    const catalog = await deps.catalog();
    const planned = planTurn(
      { prompt: input.question, modelIds: [input.modelId], skill: input.skill },
      catalog,
      deps.provider(),
    );
    if (!planned.ok || catalog === null) return failed(input.threadId);

    const written = await deps.writeTurn({
      ownerId: input.appUserId,
      threadId: input.threadId,
      plan: planned.plan,
      scheduled: true,
    });
    if (!written.ok) return failed(input.threadId);

    const target = { turnId: written.turnId, modelId: input.modelId };
    const call: ChatRequest = {
      modelId: input.modelId,
      turnId: written.turnId,
      messages: [{ role: "user", content: planned.plan.prompt }],
      skill: input.skill,
    };
    const column = written.responses.find((row) => row.modelId === input.modelId);
    const agent = turnAgentOf(
      input.modelId,
      catalog,
      planned.plan.prompt,
      column?.modelName ?? null,
    );
    try {
      await drain(await deps.startAnswer(input.actorId, input.appUserId, call, agent));
    } catch (error) {
      deps.logError("scheduled turn did not start", error);
      await deps.markFailed(target).catch((markError: unknown) => {
        deps.logError("could not mark the scheduled answer failed", markError);
      });
    }
    const status = await deps.storedStatus(target).catch(() => null);
    return {
      status: outcomeOf(status),
      turnId: written.turnId,
      threadId: written.threadId,
    };
  };
