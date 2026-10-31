/**
 * At most one locked-skip audit row per key per window (#341). A scanner that
 * keeps uploading while its owner's vault is locked, or anyone who knows a
 * connection id, would otherwise add one row per request. The map lives in
 * the process; a restart starts it empty, which at worst writes one more row.
 *
 * Pure apart from the map it closes over; the clock is passed in.
 */

export const SKIP_AUDIT_WINDOW_MS = 10 * 60_000;

export const createSkipThrottle = (
  options: Readonly<{ now: () => number; windowMs?: number }>,
): ((key: string) => boolean) => {
  const windowMs = options.windowMs ?? SKIP_AUDIT_WINDOW_MS;
  const lastWritten = new Map<string, number>();
  return (key) => {
    const now = options.now();
    // Drop keys whose window has passed, so the map stays small.
    for (const [seen, at] of lastWritten) {
      if (now - at >= windowMs) lastWritten.delete(seen);
    }
    if (lastWritten.has(key)) return false;
    lastWritten.set(key, now);
    return true;
  };
};
