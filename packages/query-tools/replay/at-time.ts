import { type AvailableReading, isAvailable, type ReplayReading } from "./items";
import { inLocalDay, localDayBounds, minutesBetween } from "./local-time";
import { type ReplayDay } from "./replay-day";

/**
 * What a stream reads at a moment of the day, and where its chart has gaps.
 * Pure, free of I/O. When there is no value to show, the result says why in
 * words; it never carries an older or a neighbouring value as if current.
 */

/** Which series: a stream, and for glucose the specimen, since blood and sensor never mix. */
export type SeriesSelector =
  | Readonly<{ stream: "heart_rate" | "steps" | "resting_heart_rate" | "hrv_rmssd" }>
  | Readonly<{ stream: "glucose"; specimen: "blood" | "sensor" }>;

/** Minutes after which a reading is stale at least, per stream. */
export const STALE_AFTER_MIN = {
  heart_rate: 30,
  glucose: 30,
  steps: 30,
  resting_heart_rate: 1440,
  hrv_rmssd: 1440,
} as const;

/**
 * A reading is stale once it is older than its stream's limit or twice the
 * time it stands for, whichever is longer: a 15-minute sample is still current
 * 20 minutes on, a reading from two hours ago is not.
 */
export const staleAfterMin = (reading: ReplayReading): number =>
  Math.max(STALE_AFTER_MIN[reading.stream], 2 * reading.interval_min);

export const UNAVAILABLE_WHY = [
  "missing",
  "not_yet",
  "not_recorded",
  "outside_day",
] as const;

export type ReadingState =
  | Readonly<{ state: "available"; reading: AvailableReading; age_min: number }>
  /** The last value is too old to stand for now: show it only as stale, with its age. */
  | Readonly<{
      state: "stale";
      reading: AvailableReading;
      age_min: number;
      stale_after_min: number;
    }>
  | Readonly<{
      state: "unavailable";
      why: (typeof UNAVAILABLE_WHY)[number];
      /** The sentence to show in place of a value. */
      text: string;
    }>;

const matches =
  (selector: SeriesSelector) =>
  (reading: ReplayReading): boolean =>
    reading.stream === selector.stream &&
    (selector.stream !== "glucose" ||
      (reading.stream === "glucose" && reading.specimen === selector.specimen));

/** One series of the day, in time order. */
export const seriesOf = (
  day: ReplayDay,
  selector: SeriesSelector,
): readonly ReplayReading[] =>
  day.readings
    .filter(matches(selector))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

/** What the series reads at `cursor`: its value, a stale value with its age, or why there is none. */
export const readingAt = (
  day: ReplayDay,
  selector: SeriesSelector,
  cursor: Date,
): ReadingState => {
  if (!inLocalDay(cursor, localDayBounds(day.day, day.time_zone))) {
    return {
      state: "unavailable",
      why: "outside_day",
      text: `That time is not on ${day.day}.`,
    };
  }
  const series = seriesOf(day, selector);
  if (series.length === 0) {
    return {
      state: "unavailable",
      why: "not_recorded",
      text: "Not recorded on this day.",
    };
  }
  const latest = series
    .filter((reading) => Date.parse(reading.at) <= cursor.getTime())
    .at(-1);
  if (latest === undefined) {
    return { state: "unavailable", why: "not_yet", text: "No reading yet at this time." };
  }
  if (!isAvailable(latest)) {
    return {
      state: "unavailable",
      why: "missing",
      text: `No reading: ${latest.missing_reason ?? "the source sent none"}.`,
    };
  }
  const age = minutesBetween(new Date(latest.at), cursor);
  const limit = staleAfterMin(latest);
  return age > limit
    ? { state: "stale", reading: latest, age_min: age, stale_after_min: limit }
    : { state: "available", reading: latest, age_min: age };
};

export type SeriesGap = Readonly<{
  /** The last reading before the gap, or the day's start. */
  from: string;
  /** The first reading after the gap, or the day's end. */
  to: string;
  why: "missing" | "no_readings";
}>;

export type ChartSeries = Readonly<{
  /** Runs of available readings to draw as lines; a gap between two runs is never bridged. */
  segments: readonly (readonly AvailableReading[])[];
  /** The gaps, for the chart's text alternative. */
  gaps: readonly SeriesGap[];
}>;

/**
 * A series cut where it has no value: at a missing reading, and where two
 * readings are further apart than one and a half times the longer interval.
 */
export const chartSeries = (day: ReplayDay, selector: SeriesSelector): ChartSeries => {
  const series = seriesOf(day, selector);
  type Acc = Readonly<{
    segments: readonly (readonly AvailableReading[])[];
    gaps: readonly SeriesGap[];
    previous: ReplayReading | null;
  }>;
  const broken = (previous: ReplayReading, reading: ReplayReading): boolean =>
    minutesBetween(new Date(previous.at), new Date(reading.at)) >
    1.5 * Math.max(previous.interval_min, reading.interval_min);
  const result = series.reduce<Acc>(
    (acc, reading) => {
      const { previous } = acc;
      if (!isAvailable(reading)) {
        const opensGap = previous === null || isAvailable(previous);
        return {
          segments: acc.segments,
          gaps: opensGap
            ? [
                ...acc.gaps,
                { from: previous?.at ?? reading.at, to: reading.at, why: "missing" },
              ]
            : acc.gaps,
          previous: reading,
        };
      }
      const afterMissing = previous !== null && !isAvailable(previous);
      const spaced =
        previous !== null && isAvailable(previous) && broken(previous, reading);
      const gaps: readonly SeriesGap[] = afterMissing
        ? acc.gaps.map((gap, index) =>
            index === acc.gaps.length - 1 ? { ...gap, to: reading.at } : gap,
          )
        : spaced
          ? [...acc.gaps, { from: previous.at, to: reading.at, why: "no_readings" }]
          : acc.gaps;
      const last = acc.segments.at(-1);
      const segments =
        previous === null || afterMissing || spaced || last === undefined
          ? [...acc.segments, [reading]]
          : [...acc.segments.slice(0, -1), [...last, reading]];
      return { segments, gaps, previous: reading };
    },
    { segments: [], gaps: [], previous: null },
  );
  const bounds = localDayBounds(day.day, day.time_zone);
  const first = series[0];
  const last = series.at(-1);
  const leading: readonly SeriesGap[] =
    first !== undefined &&
    minutesBetween(bounds.start, new Date(first.at)) > 1.5 * first.interval_min
      ? [{ from: bounds.start.toISOString(), to: first.at, why: "no_readings" }]
      : [];
  const end = bounds.end.toISOString();
  const trailing: readonly SeriesGap[] =
    last !== undefined &&
    isAvailable(last) &&
    minutesBetween(new Date(last.at), bounds.end) > 1.5 * last.interval_min
      ? [{ from: last.at, to: end, why: "no_readings" }]
      : [];
  // A missing run at the end of the day stays a gap to the day's end.
  const gaps =
    last !== undefined && !isAvailable(last)
      ? result.gaps.map((gap, index) =>
          index === result.gaps.length - 1 ? { ...gap, to: end } : gap,
        )
      : result.gaps;
  return { segments: result.segments, gaps: [...leading, ...gaps, ...trailing] };
};
