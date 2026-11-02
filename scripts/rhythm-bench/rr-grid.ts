/**
 * RR resolution (#418): put simulated intervals on the sampling grid of a
 * recording, and count turning points in ways that differ only in how they
 * treat ties. Pure.
 *
 * The database intervals are differences of beat sample indices at 250 Hz
 * (4 ms) or 128 Hz (7.8125 ms), rounded to whole ms (`labelledSegments`).
 * `quantiseIntervals` does the same to simulated intervals: beat times on
 * the grid, differences rounded to whole ms. Equal neighbours (ties) then
 * occur where continuous intervals would almost never tie.
 */
import { type Random } from "@/infrastructure/seeded-random";

/** Sampling periods of the two databases, ms. */
export const RR_GRIDS_MS = { afdb: 4, ltafdb: 1000 / 128 } as const;

/**
 * Intervals with their beat times rounded to a `gridMs` grid (the first beat
 * at 0), then differenced and rounded to whole ms like the database
 * intervals. `gridMs` 0 leaves the intervals as they are. Every interval
 * is kept, so labels stay aligned; one shorter than the grid can become 0.
 */
export const quantiseIntervals = (rrMs: readonly number[], gridMs: number): number[] => {
  if (!Number.isFinite(gridMs) || gridMs < 0)
    throw new Error("the RR grid must be 0 or a positive number of ms");
  if (gridMs === 0) return [...rrMs];
  const samples = [0];
  let time = 0;
  for (const rr of rrMs) {
    time += rr;
    samples.push(Math.round(time / gridMs));
  }
  return rrMs.map((_, i) => Math.round((samples[i + 1] - samples[i]) * gridMs));
};

/** Share of successive interval pairs that are equal. Null below two intervals. */
export const tiedNeighbourShare = (values: readonly number[]): number | null => {
  if (values.length < 2) return null;
  const ties = values.slice(1).filter((value, i) => value === values[i]).length;
  return ties / (values.length - 1);
};

/**
 * Points at or above both neighbours, or at or below both: every comparison
 * non-strict, so a tie with a neighbour never prevents a turning point. A
 * point equal to both neighbours counts once. The most ties could add.
 */
export const turningPointsNonStrict = (values: readonly number[]): number =>
  values
    .slice(1, -1)
    .filter(
      (value, i) =>
        (value >= values[i] && value >= values[i + 2]) ||
        (value <= values[i] && value <= values[i + 2]),
    ).length;

/**
 * Strict turning points after breaking every tie in a random order, as if
 * the values had been continuous and only rounded: each value gets a random
 * key, and equal values compare by that key.
 */
export const turningPointsTiesBroken = (
  values: readonly number[],
  random: Random,
): number => {
  const keys = values.map(() => random());
  const above = (a: number, b: number): boolean =>
    values[a] > values[b] || (values[a] === values[b] && keys[a] > keys[b]);
  let count = 0;
  for (let i = 1; i < values.length - 1; i += 1) {
    if ((above(i, i - 1) && above(i, i + 1)) || (above(i - 1, i) && above(i + 1, i)))
      count += 1;
  }
  return count;
};
