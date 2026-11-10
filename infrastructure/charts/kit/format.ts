/**
 * How the kit writes a duration and a time of day, the same way as the
 * wearables insight sentences (features/wearables/insight.ts): "7 hr 4 min",
 * "7 hr" or "45 min", and the clock in the display locale, which is 24-hour
 * "23:48" for en-GB. Pure; the locale is a parameter for the tests, and the
 * app passes nothing and gets the display locale.
 */

import { DISPLAY_LOCALE, roundTo } from "@/infrastructure/format-measure";

const MINUTES_PER_DAY = 24 * 60;

/** Minutes as "7 hr 24 min", "7 hr" or "45 min"; a negative length is written as its size. */
export const formatDuration = (
  minutes: number,
  locale: string = DISPLAY_LOCALE,
): string => {
  const total = roundTo(Math.abs(minutes), 0);
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest} min`;
  const hr = `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(hours)} hr`;
  return rest === 0 ? hr : `${hr} ${rest} min`;
};

/**
 * Minutes after midnight as a clock time in the locale: "23:48" and
 * "09:05" for en-GB, "11:48 PM" and "9:05 AM" for en-US. Values past a
 * day or below zero wrap round midnight, so 1,470 is "00:30".
 */
export const formatClock = (minutes: number, locale: string = DISPLAY_LOCALE): string => {
  const total =
    ((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const at = new Date(Date.UTC(1970, 0, 1, Math.floor(total / 60), total % 60));
  // A 24-hour clock pads the hour ("09:05"); a 12-hour one does not ("9:05 AM").
  const cycle = new Intl.DateTimeFormat(locale, { hour: "numeric" }).resolvedOptions()
    .hourCycle;
  const padded = cycle === "h23" || cycle === "h24";
  return new Intl.DateTimeFormat(locale, {
    hour: padded ? "2-digit" : "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(at);
};

/**
 * The three words under a whole day: midnight, midday, midnight. On a
 * 24-hour clock the day ends at "24:00", so its two ends never read the
 * same; a 12-hour clock writes them as it does any time.
 */
export const dayAxis = (
  locale: string = DISPLAY_LOCALE,
): readonly [string, string, string] => {
  const cycle = new Intl.DateTimeFormat(locale, { hour: "numeric" }).resolvedOptions()
    .hourCycle;
  const end = cycle === "h23" || cycle === "h24" ? "24:00" : formatClock(0, locale);
  return [formatClock(0, locale), formatClock(12 * 60, locale), end];
};
