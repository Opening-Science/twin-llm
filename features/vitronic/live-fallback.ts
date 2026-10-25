/**
 * The scanner lives on the user's LAN, so it is often unreachable. Reads that
 * are only an enrichment of stored snapshots must not wait on it.
 */
export const LIVE_SCAN_LIST_TIMEOUT_MS = 4000;

export type LiveAttempt<T> = Readonly<{ value: T; live: boolean }>;

/**
 * Runs `attempt`, returning `fallback` with `live: false` if it rejects or
 * takes longer than `timeoutMs`. Never throws and never logs the error body.
 */
export const liveOrFallback = async <T>(
  attempt: () => Promise<T>,
  fallback: T,
  timeoutMs: number = LIVE_SCAN_LIST_TIMEOUT_MS,
): Promise<LiveAttempt<T>> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<LiveAttempt<T>>((resolve) => {
    timer = setTimeout(() => resolve({ value: fallback, live: false }), timeoutMs);
  });
  const run = attempt().then(
    (value): LiveAttempt<T> => ({ value, live: true }),
    (): LiveAttempt<T> => ({ value: fallback, live: false }),
  );
  try {
    return await Promise.race([run, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};
