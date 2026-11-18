/**
 * Local days and clock times for the replay. Pure, free of I/O.
 *
 * A replay day is a calendar day in the person's time zone, not a UTC day: it
 * runs from local midnight to the next local midnight, so a daylight-saving
 * day has 23 or 25 hours. Instants are stored in UTC; the clock shown is the
 * local time with its offset, because on the autumn change 02:30 happens
 * twice and only the offset tells the two apart.
 */

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_MINUTE = 60_000;

/** "YYYY-MM-DD" that names a real calendar date. */
export const isCalendarDay = (day: string): boolean => {
  const match = DAY.exec(day);
  if (match === null) return false;
  const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const at = new Date(Date.UTC(year, month - 1, date));
  return (
    at.getUTCFullYear() === year &&
    at.getUTCMonth() === month - 1 &&
    at.getUTCDate() === date
  );
};

/**
 * An IANA zone name, spelt as the database spells it, such as "Europe/Berlin"
 * or "UTC". The runtime also takes "+01:00" and "europe/berlin": an offset has
 * no clock changes, so a Berlin day would wrongly have 24 hours on 25 October,
 * and another spelling of one zone would make a second replay key for it.
 */
const ZONE_NAME = /^(?:UTC|[A-Z][A-Za-z_]*(?:\/[A-Z][A-Za-z0-9_+-]*)+)$/;

/** An IANA time zone the runtime knows, spelt as named, such as "Europe/Berlin" or "UTC". */
export const isTimeZone = (timeZone: string): boolean => {
  if (!ZONE_NAME.test(timeZone)) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone });
    return true;
  } catch {
    return false;
  }
};

type Parts = Readonly<{
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}>;

/** One formatter per zone: building one is far slower than using it. */
const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  const known = FORMATTERS.get(timeZone);
  if (known !== undefined) return known;
  const made = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  FORMATTERS.set(timeZone, made);
  return made;
};

const partsIn = (at: Date, timeZone: string): Parts => {
  const parts = formatterFor(timeZone).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
};

/** Minutes the zone is ahead of UTC at that instant: 60 for Berlin in winter. */
export const offsetMinutes = (at: Date, timeZone: string): number => {
  const p = partsIn(at, timeZone);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const whole = at.getTime() - at.getUTCMilliseconds();
  return Math.round((wall - whole) / MS_PER_MINUTE);
};

const pad = (value: number): string => String(value).padStart(2, "0");

const offsetText = (minutes: number): string => {
  const sign = minutes < 0 ? "-" : "+";
  const whole = Math.abs(minutes);
  return `${sign}${pad(Math.floor(whole / 60))}:${pad(whole % 60)}`;
};

export type LocalClock = Readonly<{
  /** The local calendar day, "YYYY-MM-DD". */
  day: string;
  /** The local wall-clock time, "HH:MM". */
  time: string;
  /** The offset from UTC at that instant, "+01:00". */
  offset: string;
}>;

/** What a clock in the zone showed at that instant. */
export const localClock = (at: Date, timeZone: string): LocalClock => {
  const p = partsIn(at, timeZone);
  return {
    day: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    time: `${pad(p.hour)}:${pad(p.minute)}`,
    offset: offsetText(offsetMinutes(at, timeZone)),
  };
};

/** The instant of local midnight at the start of `day`. */
const localMidnight = (day: string, timeZone: string): Date => {
  const [year, month, date] = day.split("-").map(Number);
  const wall = Date.UTC(year ?? 0, (month ?? 1) - 1, date ?? 1);
  // Two passes: the offset at a first guess, then at the instant that guess gives,
  // which settles it unless the zone changes its clocks at midnight itself.
  const first = wall - offsetMinutes(new Date(wall), timeZone) * MS_PER_MINUTE;
  return new Date(wall - offsetMinutes(new Date(first), timeZone) * MS_PER_MINUTE);
};

const nextDay = (day: string): string => {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (date ?? 1) + 1))
    .toISOString()
    .slice(0, 10);
};

export type LocalDayBounds = Readonly<{
  /** Local midnight at the start of the day, as an instant. */
  start: Date;
  /** Local midnight at the start of the next day: the day ends just before it. */
  end: Date;
  /** 24, or 23 and 25 on a daylight-saving day. */
  hours: number;
}>;

/** Where a local calendar day starts and ends. */
export const localDayBounds = (day: string, timeZone: string): LocalDayBounds => {
  const start = localMidnight(day, timeZone);
  const end = localMidnight(nextDay(day), timeZone);
  return { start, end, hours: (end.getTime() - start.getTime()) / 3_600_000 };
};

/** True when the instant falls inside the local day: from its start, before its end. */
export const inLocalDay = (at: Date, bounds: LocalDayBounds): boolean =>
  at.getTime() >= bounds.start.getTime() && at.getTime() < bounds.end.getTime();

/** Minutes between two instants. */
export const minutesBetween = (from: Date, to: Date): number =>
  (to.getTime() - from.getTime()) / MS_PER_MINUTE;

/** The calendar day after `day`. */
export const dayAfter = (day: string): string => nextDay(day);

/** The calendar day before `day`. */
export const dayBefore = (day: string): string => {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (date ?? 1) - 1))
    .toISOString()
    .slice(0, 10);
};

/**
 * The instant a clock in the zone shows `time` ("HH:MM") on `day`. When the
 * autumn change makes that time happen twice, the first; when the spring
 * change skips it, the instant the clock shows an hour later, as it jumps.
 */
export const localInstant = (day: string, time: string, timeZone: string): Date => {
  const [year, month, date] = day.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  const wall = Date.UTC(year ?? 0, (month ?? 1) - 1, date ?? 1, hours ?? 0, minutes ?? 0);
  const before = offsetMinutes(new Date(wall - 86_400_000), timeZone);
  const after = offsetMinutes(new Date(wall + 86_400_000), timeZone);
  const matching = [...new Set([before, after])]
    .map((offset) => new Date(wall - offset * MS_PER_MINUTE))
    .filter((at) => {
      const clock = localClock(at, timeZone);
      return clock.day === day && clock.time === time;
    })
    .sort((a, b) => a.getTime() - b.getTime());
  return matching[0] ?? new Date(wall - before * MS_PER_MINUTE);
};
