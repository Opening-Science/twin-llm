/**
 * Keeps requests to one service at least `intervalMs` apart, even when several
 * chats (or several models in a compare) look things up at once: each caller
 * waits its turn in a queue. Pure: the clock is passed in.
 */

export type SpacingClock = Readonly<{
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}>;

export const createSpacing = (
  intervalMs: number,
  clock: SpacingClock,
): (() => Promise<void>) => {
  const state: { tail: Promise<void>; last: number | null } = {
    tail: Promise.resolve(),
    last: null,
  };
  return () => {
    const turn = state.tail.then(async () => {
      const wait = state.last === null ? 0 : state.last + intervalMs - clock.now();
      if (wait > 0) await clock.sleep(wait);
      state.last = clock.now();
    });
    state.tail = turn;
    return turn;
  };
};
