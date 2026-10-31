/**
 * Where the rating view goes next (#351). Pure and client-safe: it works on
 * the levels alone, in the rater's order.
 */

type Rated = Readonly<{ level: number | null }>;

/** Where a rater resumes: the first line without a rating, else the last line. */
export const resumeIndex = (lines: readonly Rated[]): number => {
  const next = lines.findIndex((line) => line.level === null);
  return next === -1 ? Math.max(0, lines.length - 1) : next;
};

/**
 * After saving line `from`: the next unrated line after it, else the first
 * unrated one before it, else the line after it (or `from` at the end).
 */
export const nextIndex = (lines: readonly Rated[], from: number): number => {
  const after = lines.findIndex((line, index) => index > from && line.level === null);
  if (after !== -1) return after;
  const before = lines.findIndex((line, index) => index < from && line.level === null);
  if (before !== -1) return before;
  return Math.min(from + 1, Math.max(0, lines.length - 1));
};

export const ratedCount = (lines: readonly Rated[]): number =>
  lines.filter((line) => line.level !== null).length;

/** "Answer 3 of 35 · 2 rated" */
export const progressText = (lines: readonly Rated[], index: number): string =>
  `Answer ${index + 1} of ${lines.length} · ${ratedCount(lines)} rated`;
