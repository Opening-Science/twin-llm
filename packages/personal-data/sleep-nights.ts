/**
 * Minutes asleep per night from sleep intervals. A night is named by the
 * calendar day the sleeper woke up, as the export wrote that day. Intervals
 * that overlap (a watch and a phone recording the same hours) are merged
 * first, so the same minutes are never counted twice. Pure.
 */

export type SleepInterval = Readonly<{
  /** `2026-09-01`: the local day the interval ended. */
  night: string;
  startMs: number;
  endMs: number;
}>;

export type SleepNight = Readonly<{ night: string; minutes: number }>;

const asleepMs = (intervals: readonly SleepInterval[]): number => {
  const sorted = intervals.toSorted((a, b) => a.startMs - b.startMs);
  const merged = sorted.reduce<readonly (readonly [number, number])[]>(
    (spans, interval) => {
      const last = spans.at(-1);
      if (last !== undefined && interval.startMs <= last[1]) {
        return [...spans.slice(0, -1), [last[0], Math.max(last[1], interval.endMs)]];
      }
      return [...spans, [interval.startMs, interval.endMs]];
    },
    [],
  );
  return merged.reduce((total, [start, end]) => total + (end - start), 0);
};

export const sleepNights = (
  intervals: readonly SleepInterval[],
): readonly SleepNight[] => {
  const byNight = Map.groupBy(
    intervals.filter((interval) => interval.endMs > interval.startMs),
    (interval) => interval.night,
  );
  return [...byNight.entries()]
    .map(([night, list]) => ({ night, minutes: Math.round(asleepMs(list) / 60_000) }))
    .toSorted((a, b) => a.night.localeCompare(b.night));
};
