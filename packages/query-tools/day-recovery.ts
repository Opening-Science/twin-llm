import { DAY_THRESHOLDS, type DayReading, type DayThresholds } from "./day-beats";

/**
 * How fast heart rate comes back after a workout. Pure, free of I/O.
 *
 * A workout is a run of consecutive readings while moving. Its baseline is the
 * last still heart rate before it. It has recovered at the first still reading
 * after it, and before the next workout, whose heart rate is within
 * `recoveryWithinPerMin` of that baseline
 * (`day-thresholds.json`, a placeholder for Robin). The minutes count from the
 * workout's last moving reading, so with readings far apart they are an upper
 * bound: "back by", never "back after exactly".
 *
 * Readings with unknown activity end a workout and never count as still, so a
 * day without activity has no workouts at all.
 */

export type Recovery = Readonly<{
  /** First and last moving reading, "HH:MM". */
  from: string;
  to: string;
  event: string | null;
  peak_per_min: number;
  /** The last still heart rate before the workout; null when there is none. */
  baseline_per_min: number | null;
  /** The first still reading back within the band; null when none that day. */
  back_at: string | null;
  /** Minutes from `to` to `back_at`: an upper bound set by the reading spacing. */
  back_within_min: number | null;
  band_per_min: number;
  thresholds: "placeholder";
}>;

const minutesOf = (time: string): number => {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
};

type Run = Readonly<{ start: number; end: number }>;

/** Index ranges of consecutive moving readings that carry a heart rate. */
const movingRuns = (readings: readonly DayReading[]): readonly Run[] =>
  readings.reduce<Run[]>((runs, reading, index) => {
    if (reading.moving !== true || reading.heartRatePerMin === null) return runs;
    const last = runs[runs.length - 1];
    return last !== undefined && last.end === index - 1
      ? [...runs.slice(0, -1), { start: last.start, end: index }]
      : [...runs, { start: index, end: index }];
  }, []);

const stillHeartRate = (reading: DayReading | undefined): number | null =>
  reading?.moving === false ? reading.heartRatePerMin : null;

/** Each workout of the day with its recovery, in time order. */
export const recoveries = (
  readings: readonly DayReading[],
  thresholds: DayThresholds = DAY_THRESHOLDS,
): readonly Recovery[] => {
  const sorted = [...readings].sort((a, b) => a.time.localeCompare(b.time));
  const band = thresholds.recoveryWithinPerMin;
  const runs = movingRuns(sorted);
  return runs.map((run, index): Recovery => {
    const workout = sorted.slice(run.start, run.end + 1);
    const baseline =
      sorted
        .slice(0, run.start)
        .map(stillHeartRate)
        .filter((value): value is number => value !== null)
        .at(-1) ?? null;
    const last = workout[workout.length - 1];
    const back =
      baseline === null
        ? undefined
        : // Only up to the next workout: a later recovery belongs to that one.
          sorted.slice(run.end + 1, runs[index + 1]?.start).find((reading) => {
            const value = stillHeartRate(reading);
            return value !== null && value <= baseline + band;
          });
    return {
      from: workout[0]?.time ?? "",
      to: last?.time ?? "",
      event: workout[0]?.event ?? null,
      peak_per_min: Math.max(...workout.map((reading) => reading.heartRatePerMin ?? 0)),
      baseline_per_min: baseline,
      back_at: back?.time ?? null,
      back_within_min:
        back === undefined || last === undefined
          ? null
          : minutesOf(back.time) - minutesOf(last.time),
      band_per_min: band,
      thresholds: "placeholder",
    };
  });
};
