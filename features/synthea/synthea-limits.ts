/**
 * The per-address limit on new runs, and how a request's address is read.
 * In memory, per server process: the hosted generator runs as one process
 * (docs/synthea-generator.md), and a restart forgetting the counts is fine.
 */

export type RateDecision =
  Readonly<{ ok: true }> | Readonly<{ ok: false; retryAfterS: number }>;

export type RateLimiter = Readonly<{
  /** Counts one run for `key` when it is under the limit. */
  take: (key: string) => RateDecision;
}>;

export const createRateLimiter = ({
  limit,
  windowMs,
  now,
}: Readonly<{ limit: number; windowMs: number; now: () => number }>): RateLimiter => {
  const hits = new Map<string, readonly number[]>();
  const take = (key: string): RateDecision => {
    const at = now();
    const recent = (hits.get(key) ?? []).filter((time) => at - time < windowMs);
    // Forget addresses with nothing in the window, so the map cannot grow forever.
    [...hits.keys()]
      .filter((other) => (hits.get(other) ?? []).every((time) => at - time >= windowMs))
      .forEach((other) => hits.delete(other));
    if (recent.length >= limit) {
      const oldest = recent[0] ?? at;
      hits.set(key, recent);
      return {
        ok: false,
        retryAfterS: Math.max(1, Math.ceil((oldest + windowMs - at) / 1000)),
      };
    }
    hits.set(key, [...recent, at]);
    return { ok: true };
  };
  return { take };
};

/**
 * The client address to count a run against. The hosted site sits behind one
 * reverse proxy that sets `X-Real-IP` or appends to `X-Forwarded-For`, so the
 * last forwarded hop is the one that proxy saw; earlier hops can be written by
 * the client. With neither header, every request shares one bucket.
 */
export const clientAddress = (headers: Headers): string => {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const hops = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);
  return hops.at(-1) ?? "direct";
};
