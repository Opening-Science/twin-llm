/**
 * Where a wearable timestamp falls on the wearer's clock: the calendar day and
 * the minutes after midnight. Pure, for the detail route's aggregation.
 *
 * Oura and Google Health write each time with the wearer's own UTC offset
 * ("2026-11-06T23:10:00+01:00"), so the clock is read straight from the text
 * and a night stays on the day it was lived, even after travel or a change to
 * summer time. WHOOP writes UTC ("…Z"), so its times are put on the viewer's
 * time zone instead, which is the best guess the server has.
 */

export type LocalClock = Readonly<{
  /** YYYY-MM-DD on the wearer's clock. */
  date: string;
  /** Minutes after local midnight, 0 to 1439. */
  minutes: number;
  /** The moment itself, for elapsed time across a change of offset. */
  epochMs: number;
}>;

const MINUTES_PER_DAY = 1440;

/** "2026-11-06T23:10", then an optional ":ss(.fff)", then an offset or Z. */
const ISO_TIME =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;

const zoneFormats = new Map<string, Intl.DateTimeFormat>();

const zoneFormat = (timeZone: string): Intl.DateTimeFormat => {
  const cached = zoneFormats.get(timeZone);
  if (cached) return cached;
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  zoneFormats.set(timeZone, format);
  return format;
};

/** Whether `timeZone` is an IANA zone this runtime knows. */
export const isTimeZone = (timeZone: string): boolean => {
  if (timeZone.length === 0 || timeZone.length > 64) return false;
  try {
    zoneFormat(timeZone);
    return true;
  } catch {
    return false;
  }
};

const onZone = (epochMs: number, timeZone: string): LocalClock => {
  const parts = Object.fromEntries(
    zoneFormat(timeZone)
      .formatToParts(new Date(epochMs))
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    epochMs,
  };
};

/**
 * The clock of one ISO timestamp. With an offset, the time as written; with Z
 * or no offset, the moment on `timeZone`. Anything else is null.
 */
export const localClock = (
  iso: string | null | undefined,
  timeZone: string,
): LocalClock | null => {
  if (!iso) return null;
  const match = ISO_TIME.exec(iso);
  if (!match) return null;
  const [, date, hour, minute, offset] = match;
  const epochMs = Date.parse(offset ? iso : `${iso}Z`);
  if (!Number.isFinite(epochMs)) return null;
  if (offset && offset !== "Z") {
    return { date: date!, minutes: Number(hour) * 60 + Number(minute), epochMs };
  }
  return onZone(epochMs, timeZone);
};

const dayMs = (day: string): number => Date.parse(`${day}T00:00:00Z`);

/** Whole days from `from` to `to`, both YYYY-MM-DD. */
export const daysBetween = (from: string, to: string): number =>
  Math.round((dayMs(to) - dayMs(from)) / 86_400_000);

export const addDays = (day: string, days: number): string =>
  new Date(dayMs(day) + days * 86_400_000).toISOString().slice(0, 10);

/** Bedtimes are minutes after 6 PM, so a night's evening and small hours stay in order. */
export const EVENING_MINUTES = 18 * 60;

/** Minutes after 6 PM: 23:10 is 310, 00:30 is 390, 17:59 is 1439. */
export const minutesAfterEvening = (minutes: number): number =>
  (((minutes - EVENING_MINUTES) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;

/**
 * The night a bedtime belongs to, named by the morning it ends on, as Oura
 * names its sleep days: from 6 PM on, the next day; before, the same day. So
 * a bedtime is always `minutesAfterEvening` after 6 PM on the day before.
 */
export const nightOf = (clock: LocalClock): string =>
  clock.minutes >= EVENING_MINUTES ? addDays(clock.date, 1) : clock.date;
