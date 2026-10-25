/**
 * Seeded randomness for the synthetic generators. Pure: the same seed and key
 * give the same numbers on every machine, so a cohort's wearable series and
 * its training conversations can be rebuilt instead of stored.
 */

/** FNV-1a, 32 bit: a stable number for a string key. */
export const hash32 = (text: string): number => {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
};

export type Random = () => number;

/** mulberry32: a small, fast generator with a 32-bit state; values in [0, 1). */
export const mulberry32 = (seed: number): Random => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** A generator for one seed and one key (a subject, a family, …). */
export const randomFor = (seed: number, key: string): Random =>
  mulberry32(hash32(`${seed}:${key}`));

/** Standard normal draw (Box–Muller); always uses exactly two values. */
export const normal = (random: Random): number => {
  const u = Math.max(random(), Number.EPSILON);
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

/** One element of a non-empty list. */
export const pick = <T>(random: Random, items: readonly [T, ...T[]]): T =>
  items[Math.floor(random() * items.length)] ?? items[0];
