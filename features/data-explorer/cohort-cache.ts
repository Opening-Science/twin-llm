/**
 * A small in-memory cache for the Data page's cohort reads.
 *
 * An entry is used only while the cohort's fingerprint (its bundle count and
 * latest ingest time, read on every request) is the one it was stored under,
 * and for at most `ttlMs`, so a new ingest or a cleared cohort shows at once
 * and nothing is kept long. It holds counts and subject_refs of synthetic
 * cohorts only, never observation values. The oldest entry goes first when it
 * is full. The read itself is still audited by the caller on every request,
 * hit or miss.
 */

export type CohortCache = Readonly<{
  read: <T>(key: string, fingerprint: string, load: () => Promise<T>) => Promise<T>;
}>;

type Entry = Readonly<{ fingerprint: string; at: number; value: Promise<unknown> }>;

export const createCohortCache = ({
  ttlMs,
  maxEntries,
  now = Date.now,
}: Readonly<{ ttlMs: number; maxEntries: number; now?: () => number }>): CohortCache => {
  // The one mutable structure here: a Map in insertion order, oldest first.
  const entries = new Map<string, Entry>();

  const read = <T>(
    key: string,
    fingerprint: string,
    load: () => Promise<T>,
  ): Promise<T> => {
    const at = now();
    const hit = entries.get(key);
    if (hit && hit.fingerprint === fingerprint && at - hit.at < ttlMs) {
      return hit.value as Promise<T>;
    }
    entries.delete(key);
    const value = load();
    entries.set(key, { fingerprint, at, value });
    // A failed read is not kept: the next request tries again.
    value.catch(() => {
      if (entries.get(key)?.value === value) entries.delete(key);
    });
    [...entries.keys()]
      .slice(0, Math.max(0, entries.size - maxEntries))
      .forEach((old) => {
        entries.delete(old);
      });
    return value;
  };

  return { read };
};
