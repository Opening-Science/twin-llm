import type { LatticeState } from "@/infrastructure/ui-kit/status-lattice-model";
import type { StatusTone } from "@/infrastructure/ui-kit/status-badge";

import { RUN_STATUS_WORDS, type TaskView } from "./task-model";

/**
 * What a task card shows about its runs (#54), as plain values. A run in
 * flight, or one that answered, failed or was refused, is a StatusLattice; a
 * run that never asked a model (skipped while locked, cut by a restart) is a
 * badge, because nothing ran to tick or cross.
 */

export type TaskRunLine =
  | Readonly<{ kind: "lattice"; state: LatticeState; label: string }>
  | Readonly<{ kind: "badge"; tone: StatusTone; label: string }>
  | Readonly<{ kind: "none" }>;

export const taskRunLine = (
  task: Pick<TaskView, "running" | "lastStatus">,
): TaskRunLine => {
  if (task.running) return { kind: "lattice", state: "working", label: "Running now" };
  switch (task.lastStatus) {
    case null:
      return { kind: "none" };
    case "complete":
      return { kind: "lattice", state: "done", label: RUN_STATUS_WORDS.complete };
    case "failed":
    case "refused":
      return {
        kind: "lattice",
        state: "error",
        label: RUN_STATUS_WORDS[task.lastStatus],
      };
    case "skipped-locked":
      return { kind: "badge", tone: "warn", label: RUN_STATUS_WORDS["skipped-locked"] };
    case "interrupted":
      return { kind: "badge", tone: "neutral", label: RUN_STATUS_WORDS.interrupted };
  }
};

/** The next run in words: when, "Paused", or "Running now". */
export const nextRunWords = (
  task: Pick<TaskView, "enabled" | "nextRunAt">,
  formatMoment: (iso: string) => string,
): string =>
  !task.enabled ? "Paused" : task.nextRunAt === null ? "—" : formatMoment(task.nextRunAt);

/** Whether the panel should keep refreshing: something runs or will run. */
export const panelIsLive = (tasks: readonly Pick<TaskView, "enabled" | "running">[]) =>
  tasks.some((task) => task.enabled || task.running);
