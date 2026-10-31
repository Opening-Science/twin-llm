import { formatNumber } from "@/infrastructure/format-measure";

/**
 * Hold to confirm as a state machine. `idle` becomes `holding` on a press;
 * letting go or drifting off before the time is up goes back to `idle`;
 * the time running out makes it `done`, which nothing but `reset` leaves, so
 * the action can only be confirmed once.
 */
export type HoldPhase = "idle" | "holding" | "done";

export type HoldEvent = "press" | "release" | "leave" | "complete" | "reset";

export const holdReducer = (phase: HoldPhase, event: HoldEvent): HoldPhase => {
  if (event === "reset") return "idle";
  if (phase === "idle") return event === "press" ? "holding" : "idle";
  if (phase === "holding") {
    if (event === "complete") return "done";
    if (event === "release" || event === "leave") return "idle";
    return "holding";
  }
  return "done";
};

/** Seconds as a person says them: `2`, `1.5`. */
const seconds = (ms: number): string => formatNumber(ms / 1000, ms % 1000 === 0 ? 0 : 1);

/** The screen-reader hint: how long to hold, and how to do it from a keyboard. */
export const holdHint = (holdMs: number): string =>
  `Press and hold for ${seconds(holdMs)} ${holdMs === 1000 ? "second" : "seconds"} to confirm. With a keyboard, hold Space or Enter.`;

/** Whole seconds still to hold, counted up so the last second reads `1`. */
export const holdSecondsLeft = (holdMs: number, elapsedMs: number): number =>
  Math.max(0, Math.ceil((holdMs - Math.max(0, elapsedMs)) / 1000));

/** The label while held under reduced motion, in place of the moving fill. */
export const holdCountdown = (secondsLeft: number): string =>
  `Keep holding: ${formatNumber(secondsLeft, 0)}`;
