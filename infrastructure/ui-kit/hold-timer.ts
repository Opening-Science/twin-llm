/**
 * The clock of a hold, apart from React and the DOM so tests can drive it.
 * A press starts it, letting go before the end stops it, and the end calls
 * `onComplete` once: after that nothing starts it again, so one hold can
 * confirm only once. A new hold needs a new timer.
 */

/** Starts a timer and returns what cancels it. */
export type HoldClock = (run: () => void, ms: number) => () => void;

export const browserClock: HoldClock = (run, ms) => {
  const handle = setTimeout(run, ms);
  return () => clearTimeout(handle);
};

export type HoldTimer = Readonly<{
  /** Starts the hold; false when it is already running or has completed. */
  press: () => boolean;
  /** Stops a running hold early; false when none was running. */
  letGo: () => boolean;
  /** When the running hold started, or null. */
  startedAt: () => number | null;
}>;

export const createHoldTimer = (
  holdMs: number,
  onComplete: () => void,
  clock: HoldClock = browserClock,
  now: () => number = Date.now,
): HoldTimer => {
  // The one piece of state a running hold needs; nothing outside sees it.
  let running: Readonly<{ cancel: () => void; since: number }> | null = null;
  let completed = false;
  return {
    press: () => {
      if (running !== null || completed) return false;
      const cancel = clock(() => {
        running = null;
        completed = true;
        onComplete();
      }, holdMs);
      running = { cancel, since: now() };
      return true;
    },
    letGo: () => {
      if (running === null) return false;
      running.cancel();
      running = null;
      return true;
    },
    startedAt: () => running?.since ?? null,
  };
};

/**
 * Lets one form submission through after a completed hold and turns away
 * every other, such as Enter pressed in a text field of the same form.
 */
export type SubmitGate = Readonly<{ open: () => void; admit: () => boolean }>;

export const createSubmitGate = (): SubmitGate => {
  let open = false;
  return {
    open: () => {
      open = true;
    },
    admit: () => {
      const admitted = open;
      open = false;
      return admitted;
    },
  };
};
