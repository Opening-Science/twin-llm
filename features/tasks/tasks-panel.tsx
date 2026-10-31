"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useActionState,
  useEffect,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";

import { formatZonedMoment } from "@/infrastructure/format-measure";
import { Button } from "@/infrastructure/ui-kit/button";
import { Field } from "@/infrastructure/ui-kit/field";
import { BellIcon, BellOffIcon } from "@/infrastructure/ui-kit/icons";
import { SegmentedControl } from "@/infrastructure/ui-kit/segmented-control";
import { isSoftHidden } from "@/infrastructure/ui-kit/soft-delete";
import { StatusBadge } from "@/infrastructure/ui-kit/status-badge";
import { StatusLattice } from "@/infrastructure/ui-kit/status-lattice";
import { UndoButton } from "@/infrastructure/ui-kit/undo-button";
import { useSoftDelete } from "@/infrastructure/ui-kit/use-soft-delete";

import { describeSchedule, weekdayName } from "./schedule";
import { NEW_THREAD } from "./task-form";
import { clearTaskNotices } from "./task-notices";
import type { TaskView } from "./task-model";
import { nextRunWords, panelIsLive, taskRunLine } from "./task-view";

/**
 * Customize · Tasks (#54): the person's scheduled skill runs and the form for
 * a new one. Nothing is scheduled until the person makes a task; a new task
 * notifies only when its bell is turned on. The actions come in as props,
 * because they live with the page that wires them.
 */

export type TaskActionState = Readonly<{ ok: boolean; message: string | null }>;

export type TaskActions = Readonly<{
  create: (previous: TaskActionState, form: FormData) => Promise<TaskActionState>;
  setEnabled: (id: string, enabled: boolean) => Promise<TaskActionState>;
  setNotify: (id: string, notify: boolean) => Promise<TaskActionState>;
  remove: (id: string) => Promise<TaskActionState>;
  markSeen: () => Promise<void>;
}>;

export type TaskOption = Readonly<{ id: string; label: string }>;

type Kind = "daily" | "weekly" | "interval";

const KINDS = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "interval", label: "Every N hours" },
] as const;

const REFRESH_MS = 10_000;

const browserTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
};

const noSubscription = () => () => undefined;

const NewTaskForm = ({
  skills,
  models,
  threads,
  create,
}: Readonly<{
  skills: readonly TaskOption[];
  models: readonly TaskOption[];
  threads: readonly TaskOption[];
  create: TaskActions["create"];
}>) => {
  const [state, action, pending] = useActionState(create, { ok: false, message: null });
  const [kind, setKind] = useState<Kind>("daily");
  // The zone is the browser's; the server renders UTC until it is read.
  const timeZone = useSyncExternalStore(noSubscription, browserTimeZone, () => "UTC");

  if (skills.length === 0 || models.length === 0) {
    return (
      <p className="text-muted-foreground mt-2 text-sm">
        {models.length === 0
          ? "No model is available right now, so nothing can be scheduled. Try again when the model list loads."
          : "No skill is available to schedule."}
      </p>
    );
  }

  return (
    <form action={action} className="surface mt-3 grid gap-4 p-4 sm:grid-cols-2">
      <Field as="select" name="skill" label="Skill" defaultValue={skills[0]?.id}>
        {skills.map((skill) => (
          <option key={skill.id} value={skill.id}>
            {skill.label}
          </option>
        ))}
      </Field>
      <Field as="select" name="modelId" label="Model" defaultValue={models[0]?.id}>
        {models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.label}
          </option>
        ))}
      </Field>
      <Field
        as="select"
        name="threadId"
        label="Thread"
        defaultValue={NEW_THREAD}
        hint="Each run adds a message to this thread, marked Scheduled."
      >
        <option value={NEW_THREAD}>A new thread, started by the first run</option>
        {threads.map((thread) => (
          <option key={thread.id} value={thread.id}>
            {thread.label}
          </option>
        ))}
      </Field>
      <Field
        name="question"
        label="Question (optional)"
        maxLength={2000}
        hint="Leave empty to ask with the skill's own description."
      />
      <div className="flex flex-col gap-2 sm:col-span-2">
        <span className="text-muted-foreground text-xs font-medium">When</span>
        <SegmentedControl
          label="How often"
          options={KINDS}
          value={kind}
          onChange={setKind}
          size="sm"
        />
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="timeZone" value={timeZone} />
        <div className="flex flex-wrap gap-4">
          {kind === "weekly" && (
            <Field as="select" name="weekday" label="Day" defaultValue="1">
              {[1, 2, 3, 4, 5, 6, 0].map((day) => (
                <option key={day} value={String(day)}>
                  {weekdayName(day)}
                </option>
              ))}
            </Field>
          )}
          {kind === "interval" ? (
            <Field
              name="hours"
              label="Every how many hours"
              type="number"
              min={1}
              max={168}
              step={1}
              defaultValue="6"
            />
          ) : (
            <Field
              name="time"
              label="Time"
              type="time"
              defaultValue="08:00"
              hint={`Your clock: ${timeZone}`}
            />
          )}
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="notify" />
        Tell me in TwinLLM when a run finishes
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit" variant="primary" disabled={pending}>
          Schedule
        </Button>
        {state.message !== null && (
          <p
            role={state.ok ? "status" : "alert"}
            className={
              state.ok ? "text-muted-foreground text-sm" : "text-destructive text-sm"
            }
          >
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
};

/** The notification switch: a bell that is pressed when on. */
const BellToggle = ({
  on,
  skill,
  onChange,
  disabled,
}: Readonly<{
  on: boolean;
  skill: string;
  onChange: (on: boolean) => void;
  disabled: boolean;
}>) => (
  <Button
    variant="pill"
    size="sm"
    aria-pressed={on}
    disabled={disabled}
    onClick={() => onChange(!on)}
    className="task-bell"
  >
    {on ? <BellIcon /> : <BellOffIcon />}
    {on ? "Notify on" : "Notify off"}
    <span className="sr-only">{` for /${skill}`}</span>
  </Button>
);

const RunLine = ({ task }: Readonly<{ task: TaskView }>) => {
  const line = taskRunLine(task);
  if (line.kind === "none") {
    return <span className="text-muted-foreground text-xs">Not run yet</span>;
  }
  if (line.kind === "badge")
    return <StatusBadge tone={line.tone}>{line.label}</StatusBadge>;
  return <StatusLattice state={line.state} label={line.label} />;
};

const TaskCard = ({
  task,
  actions,
}: Readonly<{ task: TaskView; actions: TaskActions }>) => {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const { phase, error, controls } = useSoftDelete(async () => {
    const result = await actions.remove(task.id);
    if (!result.ok) return result.message ?? "This task could not be deleted. Try again.";
    router.refresh();
    return null;
  });
  const hidden = isSoftHidden(phase);
  const zone = task.schedule.timeZone;
  const run = (step: () => Promise<TaskActionState>) =>
    startTransition(async () => {
      const result = await step();
      setMessage(result.ok ? null : result.message);
      router.refresh();
    });

  return (
    <li className="surface flex flex-col gap-3 p-4" data-hidden={hidden ? "" : undefined}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-mono text-sm">
            /{task.skill}
            {hidden && (
              <span className="text-muted-foreground font-sans"> · deleted</span>
            )}
          </h3>
          {!hidden && (
            <p className="text-muted-foreground mt-1 text-sm">
              {describeSchedule(task.schedule)} · {zone}
            </p>
          )}
        </div>
        <span className="flex shrink-0 flex-wrap items-center gap-2">
          {!hidden && (
            <>
              <BellToggle
                on={task.notify}
                skill={task.skill}
                disabled={busy}
                onChange={(on) => run(() => actions.setNotify(task.id, on))}
              />
              <Button
                variant="pill"
                size="sm"
                disabled={busy}
                onClick={() => run(() => actions.setEnabled(task.id, !task.enabled))}
              >
                {task.enabled ? "Pause" : "Resume"}
              </Button>
            </>
          )}
          <UndoButton
            label="Delete"
            actedText="Task deleted."
            variant="pill"
            size="sm"
            disabled={phase === "deleting" || phase === "deleted"}
            onAct={controls.act}
            onUndo={controls.undo}
            onExpire={controls.expire}
          />
        </span>
      </div>
      {!hidden && (
        <>
          <p className="text-sm">{task.question}</p>
          <dl className="text-muted-foreground grid gap-x-6 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
            <dt>Thread</dt>
            <dd>
              {task.threadId === null ? (
                "A new thread, started by the first run"
              ) : (
                <Link className="underline" href={`/t/${task.threadId}`}>
                  {task.threadTitle ?? "Open thread"}
                </Link>
              )}
            </dd>
            <dt>Model</dt>
            <dd className="font-mono">{task.modelId}</dd>
            <dt>Next run</dt>
            <dd>{nextRunWords(task, (iso) => formatZonedMoment(iso, zone))}</dd>
            <dt>Last run</dt>
            <dd>{formatZonedMoment(task.lastRunAt, zone)}</dd>
          </dl>
          <RunLine task={task} />
        </>
      )}
      {(message ?? (hidden ? null : error)) !== null && (
        <p role="alert" className="text-destructive text-xs">
          {message ?? error}
        </p>
      )}
    </li>
  );
};

export const TasksPanel = ({
  signedIn,
  tasks,
  skills,
  models,
  threads,
  actions,
}: Readonly<{
  signedIn: boolean;
  tasks: readonly TaskView[];
  skills: readonly TaskOption[];
  models: readonly TaskOption[];
  threads: readonly TaskOption[];
  actions: TaskActions;
}>) => {
  const router = useRouter();
  const live = panelIsLive(tasks);
  const unseen = tasks.some((task) => task.unseen);
  const { markSeen } = actions;

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [live, router]);

  useEffect(() => {
    if (unseen) void markSeen().then(clearTaskNotices);
  }, [unseen, markSeen]);

  if (!signedIn) {
    return <p className="text-muted-foreground text-sm">Sign in to schedule a skill.</p>;
  }

  return (
    <>
      <section aria-labelledby="tasks-heading">
        <h2 id="tasks-heading" className="text-lg">
          Tasks
        </h2>
        <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
          A task runs a skill on a schedule and adds the answer to a thread, as if you had
          typed it, under the same rules for where it may run. Nothing runs until you make
          a task. With personal data, a run happens only while TwinLLM is unlocked; a
          locked run is skipped and listed as such. Notifications stay inside TwinLLM and
          are off unless you turn on a task&rsquo;s bell.
        </p>
      </section>
      <section aria-labelledby="your-tasks" className="mt-8">
        <h2 id="your-tasks" className="text-lg">
          Your tasks
        </h2>
        {tasks.length === 0 ? (
          <p className="text-muted-foreground mt-1 text-sm">None yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-4">
            {tasks.map((task) => (
              <TaskCard key={task.id} task={task} actions={actions} />
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="new-task" className="mt-10">
        <h2 id="new-task" className="text-lg">
          New task
        </h2>
        <NewTaskForm
          skills={skills}
          models={models}
          threads={threads}
          create={actions.create}
        />
      </section>
    </>
  );
};
