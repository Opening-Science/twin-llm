import "server-only";

import { database } from "@/infrastructure/database";
import { vaultEnv } from "@/infrastructure/env";
import { chatModelIsLocal } from "@/infrastructure/genome-gate";
import { processSingleton } from "@/infrastructure/process-singleton";
import { vaultOpenFor } from "@/infrastructure/vault-runtime";
import { append } from "@/packages/audit/append";

import { createRunTask, type RunTaskDeps } from "./run-task";
import { dueDecision } from "./schedule";
import { createTaskScheduler } from "./task-scheduler";
import {
  claimTask,
  finishTaskRun,
  listDueTasks,
  openTaskQuestion,
  releaseInterruptedRuns,
} from "./task-store";

/**
 * The scheduler of this server process (#54): one tick loop started from
 * `instrumentation.ts`, never a second one (`processSingleton`), with no
 * external cron. The turn itself is passed in by the caller, which wires
 * the chat's own pipeline (`features/arena/scheduled-turn-runtime.ts`).
 *
 * At most one run at a time when the chat model runs on this machine, two
 * otherwise. The timer does not keep the process alive.
 */

const TICK_MS = 15_000;

const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : typeof error;

const logError = (message: string, error: unknown): void => {
  console.error(`[tasks] ${message}`, errorName(error));
};

export const startTaskScheduler: (runTurn: RunTaskDeps["runTurn"]) => true = (runTurn) =>
  processSingleton("__twinLlmTaskScheduler", () => {
    const runTask = createRunTask({
      dataMode: () => vaultEnv().dataMode,
      vaultOpen: vaultOpenFor,
      openQuestion: openTaskQuestion,
      runTurn,
      appendAudit: (input) => append(database(), input),
      finish: (task, result) => finishTaskRun(task, result),
      logError,
    });
    const scheduler = createTaskScheduler({
      now: () => new Date(),
      listDue: listDueTasks,
      claim: (task, now) => {
        const decision = dueDecision(task.schedule, task.nextRunAt, now, task.createdAt);
        return decision.due
          ? claimTask(task, decision.next, now)
          : Promise.resolve(false);
      },
      run: async (task, now) => {
        const decision = dueDecision(task.schedule, task.nextRunAt, now, task.createdAt);
        if (!decision.due) return;
        await runTask(task, {
          scheduledFor: decision.scheduledFor,
          missed: decision.missed,
        });
      },
      concurrency: () => (chatModelIsLocal() ? 1 : 2),
      logError,
    });
    void releaseInterruptedRuns()
      .catch((error: unknown) => {
        logError("could not release interrupted runs", error);
      })
      .then(() => scheduler.tick());
    setInterval(() => void scheduler.tick(), TICK_MS).unref();
    return true as const;
  })();
