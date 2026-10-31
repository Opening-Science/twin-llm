import "server-only";

import { database } from "@/infrastructure/database";
import { type FieldCipher, newRowId } from "@/infrastructure/field-cipher";
import { cipherForUser } from "@/infrastructure/field-cipher-runtime";
import { openThreadTitle } from "@/infrastructure/thread-fields";

import { nextRunAfter, type Schedule } from "./schedule";
import type { TaskRunResult } from "./run-task";
import {
  type DueTaskRow,
  leavesNotice,
  runStatusOf,
  scheduleColumns,
  scheduleOfColumns,
  type TaskView,
} from "./task-model";

/**
 * Where scheduled tasks (#54) are kept. The panel's reads and writes filter
 * on the owner; the scheduler's reads are the only ones across people, and
 * they return the question still sealed. The question is sealed with the
 * owner's keys in personal mode (#141), so creating or listing tasks needs
 * the vault open; the scheduler opens it only for a run it is allowed.
 */

const TABLE = "scheduled_tasks";

const sealQuestion = (cipher: FieldCipher, id: string, question: string): string =>
  cipher.sealText(TABLE, "question", id, question);

export const openTaskQuestion = async (
  task: Readonly<{ id: string; userId: string; sealedQuestion: string }>,
): Promise<string> =>
  (await cipherForUser(task.userId)).openText(
    TABLE,
    "question",
    task.id,
    task.sealedQuestion,
  );

const iso = (date: Date | null): string | null =>
  date === null ? null : date.toISOString();

export const listTasks = async (userId: string): Promise<readonly TaskView[]> => {
  const rows = await database().scheduledTask.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: { thread: { select: { id: true, title: true } } },
  });
  const cipher = await cipherForUser(userId);
  return rows.flatMap((row) => {
    const schedule = scheduleOfColumns(row);
    if (schedule === null) return [];
    return [
      {
        id: row.id,
        skill: row.skill,
        question: cipher.openText(TABLE, "question", row.id, row.question),
        modelId: row.modelId,
        threadId: row.threadId,
        threadTitle:
          row.thread === null
            ? null
            : openThreadTitle(cipher, row.thread.id, row.thread.title),
        schedule,
        enabled: row.enabled,
        notify: row.notify,
        running: row.runningSince !== null,
        runningSince: iso(row.runningSince),
        nextRunAt: iso(row.nextRunAt),
        lastRunAt: iso(row.lastRunAt),
        lastStatus: runStatusOf(row.lastStatus),
        unseen: row.unseen,
      },
    ];
  });
};

/** The owner's task by id: its id and skill, for the audit row of a change. */
export const findTask = (
  userId: string,
  id: string,
): Promise<Readonly<{ id: string; skill: string }> | null> =>
  database().scheduledTask.findFirst({
    where: { id, userId },
    select: { id: true, skill: true },
  });

export const countTasks = (userId: string): Promise<number> =>
  database().scheduledTask.count({ where: { userId } });

export const threadOwnedBy = async (userId: string, threadId: string): Promise<boolean> =>
  (await database().thread.count({ where: { id: threadId, userId } })) === 1;

export type NewTask = Readonly<{
  threadId: string | null;
  skill: string;
  question: string;
  modelId: string;
  schedule: Schedule;
  notify: boolean;
}>;

/** A new task starts enabled: making it is the opt-in. Its first run is the next slot. */
export const createTask = async (
  userId: string,
  task: NewTask,
  now: Date = new Date(),
): Promise<string> => {
  const id = newRowId();
  const cipher = await cipherForUser(userId);
  await database().scheduledTask.create({
    data: {
      id,
      userId,
      threadId: task.threadId,
      skill: task.skill,
      question: sealQuestion(cipher, id, task.question),
      modelId: task.modelId,
      ...scheduleColumns(task.schedule),
      enabled: true,
      notify: task.notify,
      nextRunAt: nextRunAfter(task.schedule, now, now),
      createdAt: now,
    },
    select: { id: true },
  });
  return id;
};

/** Pausing clears the next run; resuming sets it from now, so nothing missed while paused runs. */
export const setTaskEnabled = async (
  userId: string,
  id: string,
  enabled: boolean,
  now: Date = new Date(),
): Promise<boolean> => {
  const row = await database().scheduledTask.findFirst({ where: { id, userId } });
  if (row === null) return false;
  const schedule = scheduleOfColumns(row);
  await database().scheduledTask.update({
    where: { id },
    data: {
      enabled,
      nextRunAt:
        enabled && schedule !== null ? nextRunAfter(schedule, now, row.createdAt) : null,
    },
    select: { id: true },
  });
  return true;
};

export const setTaskNotify = async (
  userId: string,
  id: string,
  notify: boolean,
): Promise<boolean> =>
  (
    await database().scheduledTask.updateMany({
      where: { id, userId },
      data: { notify, ...(notify ? {} : { unseen: false }) },
    })
  ).count === 1;

export const deleteTask = async (userId: string, id: string): Promise<boolean> =>
  (await database().scheduledTask.deleteMany({ where: { id, userId } })).count === 1;

export const markTasksSeen = async (userId: string): Promise<void> => {
  await database().scheduledTask.updateMany({
    where: { userId, unseen: true },
    data: { unseen: false },
  });
};

export type TaskNotice = Readonly<{
  unseen: number;
  /** The newest unseen result: its skill and thread, for the toast's link. */
  latest: Readonly<{ skill: string; threadId: string | null; at: string }> | null;
}>;

export const taskNotice = async (userId: string): Promise<TaskNotice> => {
  const rows = await database().scheduledTask.findMany({
    where: { userId, unseen: true, notify: true },
    orderBy: { lastRunAt: "desc" },
    select: { skill: true, threadId: true, lastRunAt: true },
  });
  const first = rows[0];
  return {
    unseen: rows.length,
    latest:
      first === undefined
        ? null
        : {
            skill: first.skill,
            threadId: first.threadId,
            at: (first.lastRunAt ?? new Date(0)).toISOString(),
          },
  };
};

// ─── The scheduler's side ───────────────────────────────────────────────────

/** Enabled tasks due at `now` and not running, oldest due first. */
export const listDueTasks = async (now: Date): Promise<readonly DueTaskRow[]> => {
  const rows = await database().scheduledTask.findMany({
    where: { enabled: true, runningSince: null, nextRunAt: { lte: now } },
    orderBy: { nextRunAt: "asc" },
    take: 20,
    include: { user: { select: { clerkId: true } } },
  });
  return rows.flatMap((row) => {
    const schedule = scheduleOfColumns(row);
    return schedule === null || row.nextRunAt === null
      ? []
      : [
          {
            id: row.id,
            userId: row.userId,
            actorId: row.user.clerkId,
            threadId: row.threadId,
            skill: row.skill,
            sealedQuestion: row.question,
            modelId: row.modelId,
            schedule,
            nextRunAt: row.nextRunAt,
            createdAt: row.createdAt,
          },
        ];
  });
};

/**
 * Takes the run: moves the next run on and marks the task running, only if
 * nobody else did since it was read. One row changed means this caller won.
 */
export const claimTask = async (
  task: DueTaskRow,
  next: Date,
  now: Date,
): Promise<boolean> =>
  (
    await database().scheduledTask.updateMany({
      where: {
        id: task.id,
        enabled: true,
        runningSince: null,
        nextRunAt: task.nextRunAt,
      },
      data: { nextRunAt: next, runningSince: now },
    })
  ).count === 1;

export const finishTaskRun = async (
  task: DueTaskRow,
  result: TaskRunResult,
  now: Date = new Date(),
): Promise<void> => {
  // The task may have been deleted while it ran; then there is nothing to update.
  const row = await database().scheduledTask.findUnique({
    where: { id: task.id },
    select: { notify: true },
  });
  if (row === null) return;
  await database().scheduledTask.update({
    where: { id: task.id },
    data: {
      runningSince: null,
      lastRunAt: now,
      lastStatus: result.status,
      ...(result.turnId === null ? {} : { lastTurnId: result.turnId }),
      ...(result.threadId === null || task.threadId !== null
        ? {}
        : { threadId: result.threadId }),
      ...(leavesNotice(row.notify, result.status) ? { unseen: true } : {}),
    },
    select: { id: true },
  });
};

/**
 * At start: a run that was in flight when the server stopped is over. Its
 * next run had already moved on, so it is not repeated. An answer such a run
 * left half written is marked failed, since no browser will ever stream it.
 */
export const releaseInterruptedRuns = async (now: Date = new Date()): Promise<number> => {
  await database().modelResponse.updateMany({
    where: { status: "STREAMING", turn: { scheduled: true } },
    data: { status: "FAILED", completedAt: now },
  });
  return (
    await database().scheduledTask.updateMany({
      where: { runningSince: { not: null } },
      data: { runningSince: null, lastStatus: "interrupted" },
    })
  ).count;
};
