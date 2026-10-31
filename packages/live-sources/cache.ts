/**
 * A small time-limited cache for live lookup answers, so the same question
 * does not reach NCBI or Ensembl twice within a day. A hit sends nothing, so it
 * writes no ledger row. Kept in this server's memory only; it is gone on
 * restart. Pure: the clock is passed in.
 */

export type TtlCache<V> = Readonly<{
  get: (key: string) => V | undefined;
  set: (key: string, value: V) => void;
  size: () => number;
}>;

export const createTtlCache = <V>(
  options: Readonly<{ ttlMs: number; maxEntries: number; now: () => number }>,
): TtlCache<V> => {
  // A Map keeps insertion order, so the first key is the oldest entry.
  const entries = new Map<string, Readonly<{ value: V; expires: number }>>();
  return {
    get: (key) => {
      const entry = entries.get(key);
      if (entry === undefined) return undefined;
      if (entry.expires <= options.now()) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set: (key, value) => {
      entries.delete(key);
      entries.set(key, { value, expires: options.now() + options.ttlMs });
      while (entries.size > options.maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
    size: () => entries.size,
  };
};
