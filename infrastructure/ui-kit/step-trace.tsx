"use client";

import { type ReactNode, useId, useState } from "react";

import { formatElapsed } from "@/infrastructure/format-measure";
import { cn } from "@/infrastructure/ui";

import { ChevronIcon, CrossIcon, DashIcon, TickIcon } from "./icons";
import {
  currentStep,
  STEP_STATE_WORDS,
  type StepState,
  traceAnnouncement,
  traceHeadline,
  type TraceState,
  type TraceStep,
} from "./step-trace-model";
import { useElapsed } from "./use-elapsed";

/**
 * Shows what a piece of work is doing while it runs, then gets out of the way.
 *
 * Working: one line names the step in progress, with a quiet shimmer and a
 * live timer, and the steps list beneath it (done steps ticked, the current
 * one pulsing). Settled: the line becomes "Used N tools in X.Xs" and the
 * list folds; the line is the toggle (a button with `aria-expanded`). A step
 * may carry a `detail` that replaces its plain label in the list, such as a
 * card that folds out further.
 *
 * Screen readers hear the trace start and settle, through a polite live
 * region whose words never include the timer (`traceAnnouncement`). Motion
 * is CSS only (globals.css, `.step-trace*`) and stops under reduced motion.
 *
 * `revealKey`: when it changes, the list opens, so a caller can show a step
 * the person asked about (a number pressed in an answer).
 */

export type StepTraceStep = TraceStep & Readonly<{ detail?: ReactNode }>;

export type StepTraceProps = Readonly<{
  steps: readonly StepTraceStep[];
  state: TraceState;
  /** Said on the line while working and no step is in progress. */
  workingLabel?: string;
  /** What one step is, for the settled count ("tool" gives "Used 3 tools"). */
  noun?: string;
  /** The list's accessible name. */
  listLabel?: string;
  revealKey?: number;
  className?: string;
}>;

const MARKERS: Readonly<Record<StepState, ReactNode>> = {
  pending: <span className="step-trace-dot" data-hollow="" />,
  current: <span className="step-trace-dot" data-pulse="" />,
  done: <TickIcon className="text-winner" />,
  skipped: <DashIcon className="text-muted-foreground" />,
  failed: <CrossIcon className="text-destructive" />,
};

export const StepMarker = ({ state }: Readonly<{ state: StepState }>) => (
  <span className="step-trace-marker" data-state={state}>
    <span aria-hidden="true" className="contents">
      {MARKERS[state]}
    </span>
    <span className="sr-only">{STEP_STATE_WORDS[state]}: </span>
  </span>
);

export const StepTrace = ({
  steps,
  state,
  workingLabel,
  noun,
  listLabel = "Steps",
  revealKey,
  className,
}: StepTraceProps) => {
  const listId = useId();
  const working = state === "working";
  const elapsed = useElapsed(working);
  // Open while working; fold when it settles. The person can toggle either way,
  // and a new `revealKey` opens it again.
  const [open, setOpen] = useState(working);
  const [seenState, setSeenState] = useState(state);
  const [seenReveal, setSeenReveal] = useState(revealKey);
  if (seenState !== state) {
    setSeenState(state);
    setOpen(state === "working");
  }
  if (seenReveal !== revealKey) {
    setSeenReveal(revealKey);
    if (revealKey !== undefined) setOpen(true);
  }

  const headline = traceHeadline({
    state,
    steps,
    elapsedMs: elapsed,
    workingLabel,
    noun,
  });
  return (
    <div className={cn("step-trace", className)} data-state={state}>
      <p role="status" className="sr-only">
        {traceAnnouncement(state, steps, noun)}
      </p>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((was) => !was)}
        className="step-trace-toggle"
      >
        <ChevronIcon className={cn("transition-transform", open && "rotate-90")} />
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            working && currentStep(steps) !== null && "step-trace-working",
            working && currentStep(steps) === null && "step-trace-waiting",
          )}
        >
          {headline}
        </span>
        {working && (
          <span className="step-trace-timer" aria-hidden="true">
            {formatElapsed(elapsed ?? 0)}
          </span>
        )}
      </button>
      <ol id={listId} hidden={!open} aria-label={listLabel} className="step-trace-list">
        {steps.map((step) => (
          <li key={step.id} className="step-trace-step" data-state={step.state}>
            <StepMarker state={step.state} />
            <div className="min-w-0 flex-1">{step.detail ?? step.label}</div>
          </li>
        ))}
      </ol>
    </div>
  );
};
