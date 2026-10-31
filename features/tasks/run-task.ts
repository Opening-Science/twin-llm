import type { DataMode } from "@/infrastructure/data-mode-policy";
import type { AppendInput } from "@/packages/audit/append";

import type { DueTaskRow, RunStatus } from "./task-model";
import { taskRunEvent } from "./task-model";

/**
 * One scheduled run (#54), with every effect passed in.
 *
 * In personal mode a run happens only while the owner's vault is open in
 * this process. Checking does not count as use, so a schedule never keeps a
 * vault from locking. Locked at the scheduled time, the run is skipped and
 * recorded as "skipped: locked"; it is not retried before its next time.
 *
 * Every run writes a `task.run` audit row before anything else happens. If
 * that write fails the model is not called. The turn itself goes through
 * `runTurn`, which is the typed-turn pipeline with its own audit rows and
 * ledger entries.
 */

export type TaskTurnOutcome = Readonly<{
  status: "complete" | "failed" | "refused";
  turnId: string | null;
  threadId: string | null;
}>;

export type TaskRunResult = Readonly<{
  status: RunStatus;
  turnId: string | null;
  threadId: string | null;
}>;

export type RunTaskDeps = Readonly<{
  dataMode: () => DataMode;
  /** True when the actor's vault is open now; must not count as use. */
  vaultOpen: (actorId: string) => boolean;
  openQuestion: (task: DueTaskRow) => Promise<string>;
  runTurn: (
    input: Readonly<{
      actorId: string;
      appUserId: string;
      threadId: string | null;
      skill: string;
      question: string;
      modelId: string;
    }>,
  ) => Promise<TaskTurnOutcome>;
  appendAudit: (input: AppendInput) => Promise<unknown>;
  finish: (task: DueTaskRow, result: TaskRunResult) => Promise<void>;
  logError: (message: string, error: unknown) => void;
}>;

export type RunContext = Readonly<{ scheduledFor: Date; missed: number }>;

export const createRunTask =
  (deps: RunTaskDeps) =>
  async (task: DueTaskRow, context: RunContext): Promise<TaskRunResult> => {
    const end = async (result: TaskRunResult): Promise<TaskRunResult> => {
      await deps.finish(task, result);
      return result;
    };
    const unchanged = { turnId: null, threadId: task.threadId };

    if (deps.dataMode() === "personal" && !deps.vaultOpen(task.actorId)) {
      await deps
        .appendAudit(taskRunEvent(task, { decision: "skipped: locked", ...context }))
        .catch((error: unknown) => deps.logError("skip not audited", error));
      return end({ status: "skipped-locked", ...unchanged });
    }

    try {
      await deps.appendAudit(taskRunEvent(task, { decision: "run", ...context }));
    } catch (error) {
      deps.logError("run not audited, not started", error);
      return end({ status: "failed", ...unchanged });
    }

    const question = await deps.openQuestion(task).catch(() => null);
    // The vault locked between the check and the read.
    if (question === null) return end({ status: "skipped-locked", ...unchanged });

    const outcome = await deps
      .runTurn({
        actorId: task.actorId,
        appUserId: task.userId,
        threadId: task.threadId,
        skill: task.skill,
        question,
        modelId: task.modelId,
      })
      .catch((error: unknown) => {
        deps.logError("scheduled turn failed", error);
        return { status: "failed", ...unchanged } as const;
      });
    return end({
      status: outcome.status,
      turnId: outcome.turnId,
      threadId: outcome.threadId ?? task.threadId,
    });
  };
