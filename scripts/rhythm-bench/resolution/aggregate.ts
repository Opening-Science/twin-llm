/**
 * The aggregation ladder of the resolution study (#290): from labelled RR
 * intervals to what a wearable could export at 30 s, 5 min, hourly and daily
 * resolution, and one score per level for a unit of time (a day or an hour).
 * Pure.
 *
 * An interval belongs to the epoch that holds the beat ending it. Successive
 * differences are taken only between neighbouring intervals of the same run
 * (a stretch without a gap), so nothing is computed across a gap in a record.
 * Every score is oriented so that a higher value is more AF-like.
 */
import {
  beatWindows,
  IRREGULARITY_THRESHOLDS,
  irregularityWindow,
} from "@/packages/query-tools/stats";

export type Interval = Readonly<{
  /** Time of the beat that ends the interval, ms from the start of the unit's clock. */
  endMs: number;
  rrMs: number;
  /** The reference (or simulator) label of that beat is AF. */
  af: boolean;
  /** Contiguous stretch id; differences never cross runs. */
  run: number;
}>;

/** Intervals from beat times (one more than labels), all in one run. */
export const intervalsFromBeats = <L>(
  beatTimesMs: readonly number[],
  labels: readonly L[],
  isAf: (label: L) => boolean,
  run = 0,
): Interval[] =>
  labels.map((label, i) => ({
    endMs: beatTimesMs[i + 1],
    rrMs: beatTimesMs[i + 1] - beatTimesMs[i],
    af: isAf(label),
    run,
  }));

export const MS = {
  s30: 30_000,
  min5: 300_000,
  hour: 3_600_000,
  day: 86_400_000,
} as const;

/** Fewest intervals an epoch needs for its summaries (assumption: a device drops sparse epochs). */
export const MIN_EPOCH_INTERVALS = 10;

/** What a device could export for one epoch: mean heart rate and RMSSD. */
export type EpochSummary = Readonly<{
  index: number;
  startMs: number;
  n: number;
  /** 60000 / mean RR, /min; null when the epoch has too few intervals. */
  meanHr: number | null;
  /** RMSSD of the epoch's intervals, ms. */
  rmssdMs: number | null;
  /** RMSSD divided by the mean RR. */
  nrmssd: number | null;
  /** Share of the epoch's intervals labelled AF (truth, not exported). */
  afShare: number | null;
}>;

const meanOf = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((total, v) => total + v, 0) / values.length;

/** RMSSD over neighbouring pairs in the same run; null without a pair. */
export const rmssdOf = (intervals: readonly Interval[]): number | null => {
  let total = 0;
  let pairs = 0;
  for (let i = 1; i < intervals.length; i += 1) {
    if (intervals[i].run !== intervals[i - 1].run) continue;
    total += (intervals[i].rrMs - intervals[i - 1].rrMs) ** 2;
    pairs += 1;
  }
  return pairs === 0 ? null : Math.sqrt(total / pairs);
};

/**
 * Epoch summaries for every epoch from 0 to the one holding the last
 * interval, in order; `spanMs` (optional) extends the list to a fixed length.
 */
export const epochSummaries = (
  intervals: readonly Interval[],
  epochMs: number,
  spanMs?: number,
  minIntervals = MIN_EPOCH_INTERVALS,
): EpochSummary[] => {
  const last = intervals.at(-1);
  const count = Math.max(
    spanMs === undefined ? 0 : Math.ceil(spanMs / epochMs),
    last === undefined ? 0 : Math.floor(last.endMs / epochMs) + 1,
  );
  const groups = Array.from({ length: count }, (): Interval[] => []);
  for (const interval of intervals) {
    const index = Math.floor(interval.endMs / epochMs);
    if (index >= 0 && index < count) groups[index].push(interval);
  }
  return groups.map((group, index) => {
    const meanRr = meanOf(group.map((each) => each.rrMs));
    const enough = group.length >= minIntervals && meanRr !== null && meanRr > 0;
    const rmssd = enough ? rmssdOf(group) : null;
    return {
      index,
      startMs: index * epochMs,
      n: group.length,
      meanHr: enough ? 60_000 / meanRr : null,
      rmssdMs: rmssd,
      nrmssd: rmssd === null || meanRr === null ? null : rmssd / meanRr,
      afShare:
        group.length === 0 ? null : group.filter((each) => each.af).length / group.length,
    };
  });
};

/** Share of epochs with a summary whose nRMSSD is above the tool's 0.1; null without any. */
export const irregularShare = (
  epochs: readonly EpochSummary[],
  above: number = IRREGULARITY_THRESHOLDS.nrmssdAbove,
): number | null => {
  const scored = epochs.filter((epoch) => epoch.nrmssd !== null);
  return scored.length === 0
    ? null
    : scored.filter((epoch) => (epoch.nrmssd ?? 0) > above).length / scored.length;
};

/**
 * Root mean square of the change in mean heart rate between neighbouring
 * epochs that both have a summary (an HR-only export); null without a pair.
 */
export const hrJumps = (epochs: readonly EpochSummary[]): number | null => {
  let total = 0;
  let pairs = 0;
  for (let i = 1; i < epochs.length; i += 1) {
    const a = epochs[i - 1].meanHr;
    const b = epochs[i].meanHr;
    if (a === null || b === null) continue;
    total += (b - a) ** 2;
    pairs += 1;
  }
  return pairs === 0 ? null : Math.sqrt(total / pairs);
};

/**
 * Share of the consecutive 128-interval windows (inside runs) that the
 * `rhythm_irregularity` flag marks; null when there is no whole window.
 */
export const beatFlagShare = (intervals: readonly Interval[]): number | null => {
  const runs = new Map<number, number[]>();
  for (const interval of intervals) {
    const run = runs.get(interval.run);
    if (run === undefined) runs.set(interval.run, [interval.rrMs]);
    else run.push(interval.rrMs);
  }
  const windows = [...runs.values()].flatMap((rr) =>
    beatWindows(rr, IRREGULARITY_THRESHOLDS.windowBeats),
  );
  return windows.length === 0
    ? null
    : windows.filter((rr) => irregularityWindow(rr).flagged).length / windows.length;
};

/** The night the daily summaries are taken over: midnight to 06:00 (assumption). */
export const NIGHT_END_MS = 6 * MS.hour;

/**
 * One day as the v3 synthetic wearables report it, computed from beats:
 * daily mean heart rate (mean of the 5 min epochs), resting heart rate (mean
 * of the night's 5 min epochs) and RMSSD (mean of the night's 5 min RMSSDs,
 * the way nightly HRV is commonly averaged). Null where no epoch qualifies.
 */
export const dailySummary = (
  intervals: readonly Interval[],
  nightEndMs = NIGHT_END_MS,
): Readonly<{
  heartRate: number | null;
  restingHeartRate: number | null;
  hrvRmssd: number | null;
}> => {
  const epochs = epochSummaries(intervals, MS.min5);
  const night = epochs.filter((epoch) => epoch.startMs + MS.min5 <= nightEndMs);
  const values = (
    list: readonly EpochSummary[],
    pick: (e: EpochSummary) => number | null,
  ) => list.map(pick).filter((value): value is number => value !== null);
  return {
    heartRate: meanOf(values(epochs, (e) => e.meanHr)),
    restingHeartRate: meanOf(values(night, (e) => e.meanHr)),
    hrvRmssd: meanOf(values(night, (e) => e.rmssdMs)),
  };
};

/** nRMSSD of all the unit's intervals together (one epoch the size of the unit). */
export const unitNrmssd = (intervals: readonly Interval[]): number | null => {
  const rmssd = rmssdOf(intervals);
  const meanRr = meanOf(intervals.map((each) => each.rrMs));
  return rmssd === null || meanRr === null || meanRr === 0 ? null : rmssd / meanRr;
};

/** Every score of the ladder; which ones apply depends on the unit (day or hour). */
export const FEATURES = [
  { id: "beat.flag_share", level: "beat", label: "Share of 128-beat windows flagged" },
  {
    id: "30s.irregular_share",
    level: "30 s",
    label: "Share of 30 s epochs with nRMSSD > 0.1",
  },
  { id: "30s.hr_jumps", level: "30 s", label: "HR change between 30 s epochs (RMS)" },
  {
    id: "5min.irregular_share",
    level: "5 min",
    label: "Share of 5 min epochs with nRMSSD > 0.1",
  },
  { id: "5min.hr_jumps", level: "5 min", label: "HR change between 5 min epochs (RMS)" },
  {
    id: "1h.irregular_share",
    level: "hourly",
    label: "Share of hours with nRMSSD > 0.1",
  },
  { id: "1h.hr_jumps", level: "hourly", label: "HR change between hours (RMS)" },
  { id: "unit.nrmssd", level: "unit", label: "nRMSSD of all beats in the unit" },
  { id: "unit.heart_rate", level: "unit", label: "Mean heart rate of the unit" },
  { id: "day.resting_heart_rate", level: "daily", label: "Resting heart rate (night)" },
  { id: "day.hrv_rmssd", level: "daily", label: "RMSSD (night mean of 5 min)" },
] as const;

export type FeatureId = (typeof FEATURES)[number]["id"];
export type Features = Readonly<Partial<Record<FeatureId, number | null>>>;

/** Scores of one day (midnight to midnight). */
export const dayFeatures = (intervals: readonly Interval[]): Features => {
  const s30 = epochSummaries(intervals, MS.s30, MS.day);
  const min5 = epochSummaries(intervals, MS.min5, MS.day);
  const hours = epochSummaries(intervals, MS.hour, MS.day);
  const daily = dailySummary(intervals);
  return {
    "beat.flag_share": beatFlagShare(intervals),
    "30s.irregular_share": irregularShare(s30),
    "30s.hr_jumps": hrJumps(s30),
    "5min.irregular_share": irregularShare(min5),
    "5min.hr_jumps": hrJumps(min5),
    "1h.irregular_share": irregularShare(hours),
    "1h.hr_jumps": hrJumps(hours),
    "unit.nrmssd": unitNrmssd(intervals),
    "unit.heart_rate": daily.heartRate,
    "day.resting_heart_rate": daily.restingHeartRate,
    "day.hrv_rmssd": daily.hrvRmssd,
  };
};

/** Scores of one hour; its intervals' `endMs` count from the start of the hour. */
export const hourFeatures = (intervals: readonly Interval[]): Features => {
  const s30 = epochSummaries(intervals, MS.s30, MS.hour);
  const min5 = epochSummaries(intervals, MS.min5, MS.hour);
  const meanRr = meanOf(intervals.map((each) => each.rrMs));
  return {
    "beat.flag_share": beatFlagShare(intervals),
    "30s.irregular_share": irregularShare(s30),
    "30s.hr_jumps": hrJumps(s30),
    "5min.irregular_share": irregularShare(min5),
    "5min.hr_jumps": hrJumps(min5),
    "unit.nrmssd": unitNrmssd(intervals),
    "unit.heart_rate": meanRr === null || meanRr === 0 ? null : 60_000 / meanRr,
  };
};

/** Splits intervals into consecutive units of `unitMs`, each re-timed from its own start. */
export const splitUnits = (
  intervals: readonly Interval[],
  unitMs: number,
): Map<number, Interval[]> => {
  const units = new Map<number, Interval[]>();
  for (const interval of intervals) {
    const index = Math.floor(interval.endMs / unitMs);
    const shifted = { ...interval, endMs: interval.endMs - index * unitMs };
    const unit = units.get(index);
    if (unit === undefined) units.set(index, [shifted]);
    else unit.push(shifted);
  }
  return units;
};
