/**
 * Negative control: each AF onset moved to a random day in that person's own
 * follow-up, from age 45 (where Synthea's AF risk starts) to the end, or from
 * birth when they never reach 45. The people, their strokes and everything
 * else stay as they are, so any ordering or excess that survives the shuffle
 * comes from who gets AF, not from when. Pure apart from the seeded random.
 */
import { type Random } from "../synthetic-wearables/random";

import { type Person, withOnset } from "./cohort";
import { DAYS_PER_YEAR } from "./poisson";

const AF_RISK_START_YEARS = 45;

/** A random day in [from, to), or null when the window is empty. */
const dayIn = (random: Random, from: number, to: number): number | null =>
  to <= from ? null : from + Math.floor(random() * (to - from));

export const shuffleAfOnsets = (
  people: readonly Person[],
  random: Random,
): readonly Person[] =>
  people.map((person) => {
    if (person.onset.af === undefined) return person;
    const riskStart = person.birth + Math.ceil(AF_RISK_START_YEARS * DAYS_PER_YEAR);
    const from = riskStart < person.end ? riskStart : person.birth;
    return withOnset(person, "af", dayIn(random, from, person.end) ?? person.onset.af);
  });

export type Spread = Readonly<{ mean: number; low: number; high: number; runs: number }>;

/** Mean and 2.5th / 97.5th percentiles of the values that are not null. */
export const spreadOf = (values: readonly (number | null)[]): Spread | null => {
  const sorted = values
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  return {
    mean: sorted.reduce((total, value) => total + value, 0) / sorted.length,
    low: at(0.025),
    high: at(0.975),
    runs: sorted.length,
  };
};
