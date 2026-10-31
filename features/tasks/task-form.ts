import { formatNumber } from "@/infrastructure/format-measure";
import { SKILL_NAME_PATTERN } from "@/infrastructure/skill-gate";

import { type Schedule, scheduleSchema } from "./schedule";
import { MAX_QUESTION_CHARS } from "./task-model";

/**
 * The new-task form (#54) read into a task, or the sentence to show. Pure:
 * the action checks the skill, model and thread against the server after
 * this. The time zone comes from the browser, so a daily time means the
 * person's own clock.
 */

export const NEW_THREAD = "new";

export type TaskForm = Readonly<{
  skill: string;
  threadId: string | null;
  /** Empty means "ask with the skill's description", as a bare `/skill` does. */
  question: string;
  modelId: string;
  schedule: Schedule;
  notify: boolean;
}>;

export const TASK_FORM_COPY = {
  skill: "Pick a skill to run.",
  model: "Pick a model.",
  schedule: "Pick when it runs: a time of day, a weekday, or a number of hours.",
  question: `Keep the question under ${formatNumber(MAX_QUESTION_CHARS, 0)} characters.`,
} as const;

type Fields = Readonly<Record<string, string | undefined>>;

const scheduleFrom = (fields: Fields): unknown => {
  const timeZone = fields.timeZone ?? "";
  switch (fields.kind) {
    case "daily":
      return { kind: "daily", time: fields.time, timeZone };
    case "weekly":
      return {
        kind: "weekly",
        time: fields.time,
        weekday: Number(fields.weekday),
        timeZone,
      };
    case "interval": {
      const hours = Number(fields.hours);
      return {
        kind: "interval",
        minutes: Number.isInteger(hours) ? hours * 60 : Number.NaN,
        timeZone,
      };
    }
    default:
      return null;
  }
};

export const readTaskForm = (
  fields: Fields,
): Readonly<{ ok: true; task: TaskForm }> | Readonly<{ ok: false; error: string }> => {
  const skill = (fields.skill ?? "").trim();
  if (!SKILL_NAME_PATTERN.test(skill)) return { ok: false, error: TASK_FORM_COPY.skill };
  const modelId = (fields.modelId ?? "").trim();
  if (modelId === "") return { ok: false, error: TASK_FORM_COPY.model };
  const question = (fields.question ?? "").trim();
  if (question.length > MAX_QUESTION_CHARS) {
    return { ok: false, error: TASK_FORM_COPY.question };
  }
  const schedule = scheduleSchema.safeParse(scheduleFrom(fields));
  if (!schedule.success) return { ok: false, error: TASK_FORM_COPY.schedule };
  const thread = (fields.threadId ?? NEW_THREAD).trim();
  return {
    ok: true,
    task: {
      skill,
      threadId: thread === NEW_THREAD || thread === "" ? null : thread,
      question,
      modelId,
      schedule: schedule.data,
      notify: fields.notify === "on",
    },
  };
};
