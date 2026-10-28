export type Clock = Readonly<{
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}>;

/**
 * Returns a function to await before each request: it waits until at least
 * `intervalMs` have passed since the previous call returned. Callers must not
 * run requests in parallel; the fetch is sequential by design.
 */
export const createThrottle = (
  intervalMs: number,
  clock: Clock,
): (() => Promise<void>) => {
  let last: number | null = null;
  return async () => {
    const wait = last === null ? 0 : last + intervalMs - clock.now();
    if (wait > 0) await clock.sleep(wait);
    last = clock.now();
  };
};
