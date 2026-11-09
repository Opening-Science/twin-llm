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
 * Minutes after midnight as a clock time in the locale: "23:48" for en-GB,
 * "11:48 PM" for en-US. Values past a day or below zero wrap round midnight,
 * so 1,470 is "00:30".
 */
export const formatClock = (minutes: number, locale: string = DISPLAY_LOCALE): string => {
  const total =
    ((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const at = new Date(Date.UTC(1970, 0, 1, Math.floor(total / 60), total % 60));
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(at);
};
