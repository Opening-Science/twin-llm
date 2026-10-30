import { formatElapsed } from "@/infrastructure/format-measure";

/**
 * What a step trace says, kept apart from how it looks so it can be tested.
 *
 * A trace is `working` until the work settles as `done` or `failed`. While
 * it works, the line names the step in progress (the newest `current` one),
 * or the caller's own words when no step is running. Once settled, the line
 * counts the steps and, when the trace watched the work happen, how long it
 * took. A trace loaded already settled never saw the clock, so it gives no
 * time rather than a made-up one.
 */

export type StepState = "pending" | "current" | "done" | "skipped" | "failed";

export type TraceState = "working" | "done" | "failed";

export type TraceStep = Readonly<{ id: string; label: string; state: StepState }>;

/** The step in progress: the newest one marked current. */
export const currentStep = <T extends TraceStep>(steps: readonly T[]): T | null =>
  steps.findLast((step) => step.state === "current") ?? null;

const count = (n: number, noun = "tool"): string => `${n} ${n === 1 ? noun : `${noun}s`}`;

const took = (elapsedMs: number | null): string =>
  elapsedMs === null ? "" : ` in ${formatElapsed(elapsedMs)}`;

export type HeadlineInput = Readonly<{
  state: TraceState;
  steps: readonly TraceStep[];
  elapsedMs: number | null;
  /** Said while working and no step is in progress. */
  workingLabel?: string;
  /** The thing a step is, for the settled count: `tool` gives "Used 3 tools". */
  noun?: string;
}>;

export const traceHeadline = ({
  state,
  steps,
  elapsedMs,
  workingLabel = "Working…",
  noun,
}: HeadlineInput): string => {
  if (state === "working") return currentStep(steps)?.label ?? workingLabel;
  const n = count(steps.length, noun);
  return state === "done"
    ? `Used ${n}${took(elapsedMs)}`
    : `Stopped after ${n}${took(elapsedMs)}`;
};

/**
 * The words the live region holds. They change only when the trace starts
 * and when it settles, never on a timer tick or a new step, so a screen
 * reader hears two sentences, not a running commentary.
 */
export const traceAnnouncement = (
  state: TraceState,
  steps: readonly TraceStep[],
  noun?: string,
): string => {
  if (state === "working") return "Working.";
  const n = count(steps.length, noun);
  return state === "done" ? `Done. Used ${n}.` : `Stopped after ${n}.`;
};

/** The words a screen reader gets for a step's marker. */
export const STEP_STATE_WORDS: Readonly<Record<StepState, string>> = {
  pending: "Waiting",
  current: "In progress",
  done: "Done",
  skipped: "No data",
  failed: "Failed",
};
