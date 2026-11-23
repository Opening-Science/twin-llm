import { DAY_THRESHOLDS, type DayThresholds } from "../day-beats";
import { seriesOf } from "./at-time";
import { type AvailableReading, isAvailable, type ReplayEvent } from "./items";
import { minutesBetween } from "./local-time";
import { type ReplayDay } from "./replay-day";

/**
 * Heart rate after a recorded walk or run, only as precise as the readings
 * allow. Pure, free of I/O.
 *
 * - The one-minute drop needs a reading at the end of the activity and the
 *   next one at most a minute later. From 15-minute readings there is none,
 *   and the result says the readings are too coarse; it is never estimated.
 * - "Back within the band" is the first reading after the end within
 *   `recoveryWithinPerMin` of the last heart rate before the activity
 *   (`day-thresholds.json`, a placeholder). Its minutes are an upper bound
 *   set by the spacing of the readings, and the result carries that spacing.
 */

/** The longest spacing a one-minute drop can be read from. */
export const ONE_MINUTE_SPACING_MAX = 1;

export type OneMinuteDrop =
  | Readonly<{
      state: "available";
      from_per_min: number;
      to_per_min: number;
      drop_per_min: number;
      evidence: readonly string[];
    }>
  | Readonly<{
      state: "insufficient_sampling";
      spacing_min: number | null;
      text: string;
    }>;

export type Recovery = Readonly<{
  activity_id: string;
  ended_at: string;
  /** The last heart rate before the activity; null when there is none. */
  before_per_min: number | null;
  band_per_min: number;
  /** The first reading back within the band; null when none that day. */
  back_at: string | null;
  /** Minutes from the end to `back_at`: an upper bound, never exact. */
  back_within_min: number | null;
  /** How far apart the readings around `back_at` are: the precision of `back_within_min`. */
  resolution_min: number | null;
  one_minute: OneMinuteDrop;
  evidence: readonly string[];
  thresholds: "placeholder";
}>;

const at = (reading: Readonly<{ at: string }>): number => Date.parse(reading.at);

const oneMinuteDrop = (
  heart: readonly AvailableReading[],
  end: number,
): OneMinuteDrop => {
  const last = heart.filter((reading) => at(reading) <= end).at(-1);
  const next = heart.find((reading) => at(reading) > end);
  const spacing =
    last === undefined || next === undefined
      ? null
      : minutesBetween(new Date(last.at), new Date(next.at));
  const closeToEnd =
    last !== undefined && (end - at(last)) / 60_000 <= ONE_MINUTE_SPACING_MAX;
  if (
    last === undefined ||
    next === undefined ||
    spacing === null ||
    spacing > ONE_MINUTE_SPACING_MAX ||
    !closeToEnd
  ) {
    return {
      state: "insufficient_sampling",
      spacing_min: spacing,
      text:
        spacing === null
          ? "No heart rate either side of the end, so no one-minute recovery."
          : `Heart rate here is ${spacing} minutes apart, too coarse for a one-minute recovery.`,
    };
  }
  return {
    state: "available",
    from_per_min: last.value,
    to_per_min: next.value,
    drop_per_min: last.value - next.value,
    evidence: [last.id, next.id],
  };
};

/** Recovery after one activity event of the day. */
export const recoveryAfter = (
  day: ReplayDay,
  activity: ReplayEvent,
  thresholds: DayThresholds = DAY_THRESHOLDS,
): Recovery => {
  const heart = seriesOf(day, { stream: "heart_rate" }).filter(isAvailable);
  const start = Date.parse(activity.from);
  const end = Date.parse(activity.to);
  const band = thresholds.recoveryWithinPerMin;
  const before = heart.filter((reading) => at(reading) < start).at(-1);
  const after = heart.filter((reading) => at(reading) > end);
  const backIndex =
    before === undefined
      ? -1
      : after.findIndex((reading) => reading.value <= before.value + band);
  const back = after[backIndex];
  const previous =
    backIndex > 0 ? after[backIndex - 1] : heart.filter((r) => at(r) <= end).at(-1);
  return {
    activity_id: activity.id,
    ended_at: activity.to,
    before_per_min: before?.value ?? null,
    band_per_min: band,
    back_at: back?.at ?? null,
    back_within_min:
      back === undefined
        ? null
        : minutesBetween(new Date(activity.to), new Date(back.at)),
    resolution_min:
      back === undefined || previous === undefined
        ? null
        : minutesBetween(new Date(previous.at), new Date(back.at)),
    one_minute: oneMinuteDrop(heart, end),
    evidence: [
      activity.id,
      ...(before === undefined ? [] : [before.id]),
      ...(back === undefined ? [] : [back.id]),
    ],
    thresholds: "placeholder",
  };
};
