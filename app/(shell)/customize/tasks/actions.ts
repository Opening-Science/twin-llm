"use server";

import { revalidatePath } from "next/cache";

import { runnableSkills } from "@/features/skills/load-skills";
import { findSkillFor } from "@/features/skills/user-skill-store";
import { readTaskForm } from "@/features/tasks/task-form";
import {
  MAX_TASKS_PER_PERSON,
  type TaskChange,
  taskChangeEvent,
} from "@/features/tasks/task-model";
import {
  countTasks,
  createTask,
  deleteTask,
  findTask,
  markTasksSeen,
  setTaskEnabled,
  setTaskNotify,
  threadOwnedBy,
} from "@/features/tasks/task-store";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { ensureAppUser } from "@/infrastructure/current-user";
import { database } from "@/infrastructure/database";
import { fetchChatCatalog } from "@/infrastructure/fetch-model-catalog";
import { vaultRefusalForAction } from "@/infrastructure/vault-runtime";
import { append } from "@/packages/audit/append";

/**
 * Making, pausing, resuming and deleting scheduled tasks (#54) on Customize ·
 * Tasks, and their notification switch. Only the owner's rows are touched,
 * only while the vault is open (the question is sealed), and each change
 * writes its `task.<change>` audit row first: if that fails, nothing changes.
 *
 * A task names a saved thread or starts a new one; there is no incognito
 * thread to name, so an incognito chat can never be scheduled.
 */

export type TaskActionState = Readonly<{ ok: boolean; message: string | null }>;

const COPY = {
  signIn: "Sign in to schedule a skill.",
  tooMany: `There are already ${String(MAX_TASKS_PER_PERSON)} tasks, the most there can be. Delete one first.`,
  noSkill: "That skill isn't one TwinLLM can run right now.",
  noModel: "That model isn't available for the active provider. Pick another.",
  noThread: "That thread isn't yours, or it no longer exists.",
  gone: "This task no longer exists.",
  failed: "The change wasn't saved. Try again.",
  created: "Scheduled. It runs at the next time shown.",
} as const;

const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : "unknown";

type Owner = Readonly<{ actorId: string; userId: string }>;

const owner = async (): Promise<Owner | string> => {
  const locked = await vaultRefusalForAction();
  if (locked !== null) return locked;
  const actorId = await resolveActorId();
  if (actorId === null) return COPY.signIn;
  return { actorId, userId: (await ensureAppUser(actorId)).id };
};

const fields = (form: FormData): Readonly<Record<string, string>> =>
  Object.fromEntries(
    [...form.entries()].flatMap(([key, value]) =>
      typeof value === "string" ? [[key, value]] : [],
    ),
  );

const done = (message: string | null = null): TaskActionState => {
  revalidatePath("/customize/tasks");
  return { ok: true, message };
};

export const createTaskAction = async (
  _previous: TaskActionState,
  form: FormData,
): Promise<TaskActionState> => {
  const who = await owner();
  if (typeof who === "string") return { ok: false, message: who };
  const read = readTaskForm(fields(form));
  if (!read.ok) return { ok: false, message: read.error };
  const { task } = read;
  if ((await countTasks(who.userId)) >= MAX_TASKS_PER_PERSON) {
    return { ok: false, message: COPY.tooMany };
  }
  const skill = await findSkillFor(task.skill, who.userId);
  if (skill === null) return { ok: false, message: COPY.noSkill };
  const catalog = await fetchChatCatalog(runnableSkills());
  if (catalog === null || !catalog.some((model) => model.id === task.modelId)) {
    return { ok: false, message: COPY.noModel };
  }
  if (task.threadId !== null && !(await threadOwnedBy(who.userId, task.threadId))) {
    return { ok: false, message: COPY.noThread };
  }
  try {
    const id = await createTask(who.userId, {
      ...task,
      question: task.question === "" ? skill.description : task.question,
    });
    await append(
      database(),
      taskChangeEvent(who.actorId, { id, skill: task.skill }, "create"),
    ).catch(async (error: unknown) => {
      // Not audited, so not kept.
      await deleteTask(who.userId, id);
      throw error;
    });
  } catch (error) {
    console.error("[tasks] could not create a task", errorName(error));
    return { ok: false, message: COPY.failed };
  }
  return done(COPY.created);
};

const change = async (
  id: string,
  kind: TaskChange,
  apply: (userId: string) => Promise<boolean>,
): Promise<TaskActionState> => {
  const who = await owner();
  if (typeof who === "string") return { ok: false, message: who };
  const task = await findTask(who.userId, id);
  if (task === null) return { ok: false, message: COPY.gone };
  try {
    await append(database(), taskChangeEvent(who.actorId, task, kind));
    if (!(await apply(who.userId))) return { ok: false, message: COPY.gone };
  } catch (error) {
    console.error(`[tasks] could not ${kind} a task`, errorName(error));
    return { ok: false, message: COPY.failed };
  }
  return done();
};

export const setTaskEnabledAction = async (
  id: string,
  enabled: boolean,
): Promise<TaskActionState> =>
  change(id, enabled ? "resume" : "pause", (userId) =>
    setTaskEnabled(userId, id, enabled),
  );

export const setTaskNotifyAction = async (
  id: string,
  notify: boolean,
): Promise<TaskActionState> =>
  change(id, notify ? "notify-on" : "notify-off", (userId) =>
    setTaskNotify(userId, id, notify),
  );

export const deleteTaskAction = async (id: string): Promise<TaskActionState> =>
  change(id, "delete", (userId) => deleteTask(userId, id));

/** The panel was seen: its notices are cleared. Not audited; it changes no task. */
export const markTasksSeenAction = async (): Promise<void> => {
  const who = await owner();
  if (typeof who === "string") return;
  await markTasksSeen(who.userId);
};
