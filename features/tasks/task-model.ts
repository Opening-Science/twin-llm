import type { AppendInput } from "@/packages/audit/append";

import { type Schedule, scheduleSchema } from "./schedule";

/**
 * A scheduled task (#54) as the scheduler, the store and the panel see it,
 * and the pure mapping between its schedule and the stored columns. No I/O.
 */

/** How a run ended, as stored in `last_status`. */
export type RunStatus =
  "complete" | "failed" | "refused" | "skipped-locked" | "interrupted";

export const RUN_STATUSES: readonly RunStatus[] = [
  "complete",
  "failed",
  "refused",
  "skipped-locked",
  "interrupted",
];

export const runStatusOf = (stored: string | null): RunStatus | null =>
  RUN_STATUSES.find((status) => status === stored) ?? null;

/** The words the panel shows for a run's outcome. */
export const RUN_STATUS_WORDS: Readonly<Record<RunStatus, string>> = {
  complete: "Answered",
  failed: "Failed",
  refused: "Refused",
  "skipped-locked": "Skipped: locked",
  interrupted: "Interrupted by a restart",
};

/** The schedule columns of `scheduled_tasks`. */
export type ScheduleColumns = Readonly<{
  scheduleKind: string;
  timeOfDay: string | null;
  weekday: number | null;
  intervalMinutes: number | null;
  timeZone: string;
}>;

export const scheduleColumns = (schedule: Schedule): ScheduleColumns => {
  switch (schedule.kind) {
    case "daily":
      return {
        scheduleKind: "daily",
        timeOfDay: schedule.time,
        weekday: null,
        intervalMinutes: null,
        timeZone: schedule.timeZone,
      };
    case "weekly":
      return {
        scheduleKind: "weekly",
        timeOfDay: schedule.time,
        weekday: schedule.weekday,
        intervalMinutes: null,
        timeZone: schedule.timeZone,
      };
    case "interval":
      return {
        scheduleKind: "interval",
        timeOfDay: null,
        weekday: null,
        intervalMinutes: schedule.minutes,
        timeZone: schedule.timeZone,
      };
  }
};

/** The stored columns as a schedule, or null when they do not make one (it never runs). */
export const scheduleOfColumns = (columns: ScheduleColumns): Schedule | null => {
  const parsed = scheduleSchema.safeParse(
    columns.scheduleKind === "interval"
      ? {
          kind: "interval",
          minutes: columns.intervalMinutes,
          timeZone: columns.timeZone,
        }
      : {
          kind: columns.scheduleKind,
          time: columns.timeOfDay,
          ...(columns.scheduleKind === "weekly" ? { weekday: columns.weekday } : {}),
          timeZone: columns.timeZone,
        },
  );
  return parsed.success ? parsed.data : null;
};

/** A due task as the scheduler reads it: the question is still sealed. */
export type DueTaskRow = Readonly<{
  id: string;
  userId: string;
  actorId: string;
  threadId: string | null;
  skill: string;
  sealedQuestion: string;
  modelId: string;
  schedule: Schedule;
  nextRunAt: Date;
  createdAt: Date;
}>;

/** A task as the panel shows it. Dates are ISO strings so it crosses to the client. */
export type TaskView = Readonly<{
  id: string;
  skill: string;
  question: string;
  modelId: string;
  threadId: string | null;
  threadTitle: string | null;
  schedule: Schedule;
  enabled: boolean;
  notify: boolean;
  running: boolean;
  runningSince: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: RunStatus | null;
  unseen: boolean;
}>;

/** A run that posted a message into the thread; only these may notify. */
export const postsMessage = (status: RunStatus): boolean =>
  status === "complete" || status === "failed" || status === "refused";

/** Whether a finished run leaves an unseen notice: only when the person turned it on. */
export const leavesNotice = (notify: boolean, status: RunStatus): boolean =>
  notify && postsMessage(status);

export const TASK_RUN_AUDIT_TOOL = "task.run";

/**
 * The audit row of one run, written before the model is called (or for a
 * skip). Ids, the skill, the model and times only; never the question.
 */
export const taskRunEvent = (
  task: Readonly<{ id: string; actorId: string; skill: string; modelId: string }>,
  run: Readonly<{
    decision: "run" | "skipped: locked";
    scheduledFor: Date;
    missed: number;
  }>,
): AppendInput => ({
  actor: task.actorId,
  sessionId: task.id,
  subjectRef: null,
  tool: TASK_RUN_AUDIT_TOOL,
  args: {
    taskId: task.id,
    skill: task.skill,
    modelId: task.modelId,
    scheduledFor: run.scheduledFor.toISOString(),
    missed: run.missed,
  },
  result: { decision: run.decision },
  rowCount: 0,
});

/** At most this many tasks per person. */
export const MAX_TASKS_PER_PERSON = 20;

/** The longest question a task may store. */
export const MAX_QUESTION_CHARS = 2_000;

export type TaskChange =
  "create" | "pause" | "resume" | "notify-on" | "notify-off" | "delete";

/** The audit row of a change the person made to a task; ids and the skill only. */
export const taskChangeEvent = (
  actorId: string,
  task: Readonly<{ id: string; skill: string }>,
  change: TaskChange,
): AppendInput => ({
  actor: actorId,
  sessionId: task.id,
  subjectRef: null,
  tool: `task.${change}`,
  args: { taskId: task.id, skill: task.skill },
  result: { changed: true },
  rowCount: 0,
});
