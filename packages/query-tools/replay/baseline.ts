import { WEARABLE_TREND_MINIMUM } from "../refusals";
import { addDays, mad, median } from "../stats";
import { isAvailable, type Origin } from "./items";
import { type ReplayDay, type ReplayKey } from "./replay-day";

/**
 * A personal baseline from a person's own nights, only when there are enough
 * of them. Pure, free of I/O.
 *
 * The baseline for a day is the median of the device's nightly value over the
 * 28 days before it, the day itself left out. It needs at least 7 nights
 * (`WEARABLE_TREND_MINIMUM`, the floor the wearable trends use); with fewer,
 * the result says how many there are and how many are needed, and there is no
 * band to draw. Only the same person's days of the same origin count: a demo
 * night never feeds a recorded baseline, nor one person's night another's.
 */

export const BASELINE_WINDOW_DAYS = 28;
export const BASELINE_MIN_NIGHTS = WEARABLE_TREND_MINIMUM;

export type NightlyStream = "resting_heart_rate" | "hrv_rmssd";

/** A reference to an item on a day: "2026-10-27/night-hrv". */
export const evidenceRef = (item: Readonly<{ day: string; id: string }>): string =>
  `${item.day}/${item.id}`;

export type Baseline =
  | Readonly<{
      state: "available";
      stream: NightlyStream;
      unit: "/min" | "ms";
      median: number;
      /** Median absolute deviation, unscaled. */
      mad: number;
      n: number;
      from_day: string;
      to_day: string;
      evidence: readonly string[];
    }>
  | Readonly<{
      state: "insufficient";
      stream: NightlyStream;
      n: number;
      needed: number;
      text: string;
    }>;

/** The baseline for `key`'s day from `history`; other people, origins and the day itself are left out. */
export const personalBaseline = (
  history: readonly ReplayDay[],
  key: ReplayKey & Readonly<{ origin: Origin }>,
  stream: NightlyStream,
): Baseline => {
  const fromDay = addDays(key.day, -BASELINE_WINDOW_DAYS);
  const toDay = addDays(key.day, -1);
  const nights = history
    .filter(
      (day) =>
        day.subject_ref === key.subject_ref &&
        day.origin === key.origin &&
        day.day >= fromDay &&
        day.day <= toDay,
    )
    .flatMap((day) =>
      day.readings.filter(
        (reading) =>
          reading.stream === stream &&
          reading.provenance === "measured" &&
          isAvailable(reading),
      ),
    );
  // One night per day, even if a history repeats a day.
  const byDay = [...new Map(nights.map((night) => [night.day, night])).values()];
  const values = byDay.map((night) => night.value ?? 0);
  const centre = median(values);
  const spread = mad(values);
  if (byDay.length < BASELINE_MIN_NIGHTS || centre === null || spread === null) {
    return {
      state: "insufficient",
      stream,
      n: byDay.length,
      needed: BASELINE_MIN_NIGHTS,
      text: `${byDay.length} of the ${BASELINE_MIN_NIGHTS} nights a personal baseline needs, in the ${BASELINE_WINDOW_DAYS} days before.`,
    };
  }
  return {
    state: "available",
    stream,
    unit: stream === "hrv_rmssd" ? "ms" : "/min",
    median: centre,
    mad: spread,
    n: byDay.length,
    from_day: fromDay,
    to_day: toDay,
    evidence: byDay.map(evidenceRef).sort(),
  };
};
