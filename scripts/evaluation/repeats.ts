/**
 * Repeats per item for consistency (#304). The question set fixes each item's
 * `repeat` (most items 1, consistency items 3); `bun run eval -- --repeats N`
 * raises every item to at least N for one run, and meta.json records N, so
 * the report and the agreement script score the run on the same items.
 *
 * An item raised above one repeat is also scored on consistency: its repeats
 * are compared as the set's own consistency items are (`score/consistency.ts`).
 * Pure.
 */
import { type Question } from "./question-set";

export const MIN_REPEATS = 2;
export const MAX_REPEATS = 10;

/** The items with at least `minimum` repeats each; null leaves them as the set has them. */
export const withRepeats = (
  items: readonly Question[],
  minimum: number | null | undefined,
): Question[] =>
  minimum === null || minimum === undefined
    ? [...items]
    : items.map((item) => {
        const repeat = Math.max(item.repeat, minimum);
        return repeat === item.repeat
          ? item
          : {
              ...item,
              repeat,
              criteria: item.criteria.includes("consistency")
                ? item.criteria
                : [...item.criteria, "consistency"],
            };
      });

/** "1", "3" or "1–3": the repeats per item of the items given. */
export const repeatsCell = (items: readonly Pick<Question, "repeat">[]): string => {
  if (items.length === 0) return "—";
  const counts = items.map((item) => item.repeat);
  const low = Math.min(...counts);
  const high = Math.max(...counts);
  return low === high ? String(low) : `${low}–${high}`;
};
