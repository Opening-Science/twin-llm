/**
 * Readings per subject, as the Data page's distribution shows them. Pure, so
 * the tests pin the bins with hand-counted numbers.
 *
 * The warehouse hands back one count per subject that has numeric rows. A
 * subject with none is a real count of 0 readings (the subject is stored, it
 * has no numeric observation), so the zeros are added from the cohort's subject
 * count rather than left out.
 *
 * Synthea's counts are skewed: most people have a few hundred readings, a few
 * have thousands. Equal bins up to the largest count would put nearly everyone
 * in the first one, so the bins run up to the 90th percentile and everything
 * above goes into one open last bin. Every bin but that one has the same width.
 */

import { countTicks } from "./chart-geometry";

export type SubjectReadingCount = Readonly<{ subjectRef: string; readings: number }>;

export type ReadingBin = Readonly<{
  /** Inclusive lower bound, in readings. */
  from: number;
  /** Inclusive upper bound, in readings; null for the open last bin ("this many or more"). */
  to: number | null;
  subjects: number;
}>;

export type ReadingDistribution = Readonly<{
  subjects: number;
  /** Subjects with no numeric reading at all. */
  withoutReadings: number;
  bins: readonly ReadingBin[];
  min: number | null;
  median: number | null;
  max: number | null;
}>;

/** Five to eleven bins of one round, whole width (`countTicks`) from 0 past `max`. */
const binEdges = (max: number): readonly number[] => {
  const ticks = countTicks(max, 10);
  // The top bin must hold `max` itself: [last edge, last edge + step) when max sits on an edge.
  const step = ticks[1]! - ticks[0]!;
  return ticks[ticks.length - 1]! > max
    ? ticks
    : [...ticks, ticks[ticks.length - 1]! + step];
};

const median = (sorted: readonly number[]): number | null => {
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

/**
 * Subjects per bin of readings. `cohortSubjects` is every synthetic subject of
 * the cohort; those missing from `counts` have 0 readings. A cohort with no
 * subjects has no bins and no statistics.
 */
export const readingDistribution = (
  counts: readonly SubjectReadingCount[],
  cohortSubjects: number,
): ReadingDistribution => {
  const withoutReadings = Math.max(0, cohortSubjects - counts.length);
  const values = [
    ...Array.from({ length: withoutReadings }, () => 0),
    ...counts.map((row) => row.readings),
  ].toSorted((a, b) => a - b);
  if (values.length === 0) {
    return {
      subjects: 0,
      withoutReadings: 0,
      bins: [],
      min: null,
      median: null,
      max: null,
    };
  }
  const max = values[values.length - 1]!;
  // Nearest rank: the smallest count at least 90% of subjects have no more than.
  const p90 = values[Math.ceil(values.length * 0.9) - 1]!;
  const edges = binEdges(p90);
  const top = edges[edges.length - 1]!;
  const bins: readonly ReadingBin[] = [
    ...edges.slice(0, -1).map((from, index) => {
      const next = edges[index + 1]!;
      return {
        from,
        to: next - 1,
        subjects: values.filter((value) => value >= from && value < next).length,
      };
    }),
    ...(max >= top
      ? [{ from: top, to: null, subjects: values.filter((value) => value >= top).length }]
      : []),
  ];
  return {
    subjects: values.length,
    withoutReadings,
    bins,
    min: values[0]!,
    median: median(values),
    max,
  };
};
