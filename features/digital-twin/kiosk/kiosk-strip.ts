import { type KioskDay } from "@/packages/query-tools/kiosk-day";

/**
 * The day strip under a beat: where each beat falls between midnight and
 * midnight, which one is showing, and the worth-a-look windows as a band.
 * Every position is a share of the day from the times the kiosk day wrote;
 * nothing here reads or makes a value. Pure, so the positions are tested.
 */

const MINUTES_PER_DAY = 24 * 60;

/** A window of one reading still gets a band this wide (about 17 minutes). */
export const MIN_WINDOW_SHARE = 0.012;

/** "HH:MM" as a share of the day, 0 at midnight. */
export const dayShare = (time: string): number => {
  const [hours = "0", minutes = "0"] = time.split(":");
  return (Number(hours) * 60 + Number(minutes)) / MINUTES_PER_DAY;
};

export type StripMark = Readonly<{ at: number; current: boolean; worth: boolean }>;

export type StripBand = Readonly<{ from: number; width: number }>;

export type DayStrip = Readonly<{
  marks: readonly StripMark[];
  bands: readonly StripBand[];
}>;

const clampShare = (value: number): number => Math.min(Math.max(value, 0), 1);

/** A window's band; a narrow one is widened around its middle, and kept inside the day. */
const band = (from: number, to: number): StripBand => {
  const width = Math.max(to - from, MIN_WINDOW_SHARE);
  const start = clampShare((from + to) / 2 - width / 2);
  return { from: Math.min(start, 1 - width), width };
};

/**
 * One mark per beat time: beats at the same minute share a mark, which is
 * current or worth a look if any of them is. One band per window.
 */
export const dayStrip = (day: KioskDay, current: number | null): DayStrip => {
  const times = [...new Set(day.beats.map((beat) => beat.time))];
  const marks = times.map((time) => {
    const at = day.beats
      .map((beat, index) => ({ beat, index }))
      .filter(({ beat }) => beat.time === time);
    return {
      at: dayShare(time),
      current: at.some(({ index }) => index === current),
      worth: at.some(({ beat }) => beat.worth_a_look),
    };
  });
  const bands = day.worth_a_look.map((window) =>
    band(dayShare(window.from), dayShare(window.to)),
  );
  return { marks, bands };
};
