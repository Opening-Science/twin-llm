import { dayAfter, localClock, localDayBounds } from "./replay/local-time";

/**
 * Relative time windows for the query tools (#901): a call says
 * `period: "last 3 months"` and the dates are worked out here, so a model
 * never turns "the last three months" into ISO dates itself. Pure.
 *
 * - The clock is the session's reference "now" (`SessionScope.now`, pinned by
 *   the eval; the real time otherwise) read in the subject's time zone
 *   (`SessionScope.timeZone`; UTC when none is known, as for every synthetic
 *   subject, which stores none).
 * - A window is whole local days and always ends with today, inclusive.
 *   `last N days` is today and the N − 1 days before; `last N weeks` is 7 × N
 *   days. `last N months` and `last N years` start the day after the same
 *   date N months or years back, a date the month lacks taken as its last day
 *   (31 May less 3 months is 28 or 29 February), so they cover exactly that
 *   span. `this year` starts on 1 January; `all` on 1 January 1900, before
 *   any stored reading.
 * - In UTC the window is plain dates, which the tools read as whole UTC days.
 *   In another zone it is the instants of local midnight at the start and the
 *   last millisecond before local midnight at the end, so a daylight-saving
 *   day counts its 23 or 25 hours.
 */

export const PERIOD_UNITS = ["day", "week", "month", "year"] as const;

export type PeriodUnit = (typeof PERIOD_UNITS)[number];

/** `last 3 months`, `last_7_days`, `last 1 year`, `this year`, `this_year` or `all`; any case. */
export const PERIOD_PATTERN =
  /^(?:last[ _]([1-9]\d{0,2})[ _](day|week|month|year)s?|this[ _]year|all)$/i;

/** The first day `all` reads from: before any stored reading. */
export const ALL_FROM_DAY = "1900-01-01";

export type Clock = Readonly<{ now: Date; timeZone: string }>;

export type ResolvedWindow = Readonly<{
  /** The period as the call gave it. */
  period: string;
  /** What the tool read: plain days in UTC, instants in another zone. */
  start: string;
  end: string;
  /** The window's first and last local day, for the answer to state. */
  first_day: string;
  last_day: string;
  time_zone: string;
}>;

type Parsed =
  | Readonly<{ kind: "last"; count: number; unit: PeriodUnit }>
  | Readonly<{ kind: "this_year" }>
  | Readonly<{ kind: "all" }>;

const isUnit = (value: string): value is PeriodUnit =>
  (PERIOD_UNITS as readonly string[]).includes(value);

/** The period's parts, or null when it is not one of the forms above. */
export const parsePeriod = (period: string): Parsed | null => {
  const match = PERIOD_PATTERN.exec(period.trim());
  if (match === null) return null;
  const unit = match[2]?.toLowerCase();
  if (match[1] !== undefined && unit !== undefined && isUnit(unit)) {
    return { kind: "last", count: Number(match[1]), unit };
  }
  return /^all$/i.test(period.trim()) ? { kind: "all" } : { kind: "this_year" };
};

const DAY_MS = 86_400_000;

const dayParts = (day: string): readonly [number, number, number] => {
  const [year, month, date] = day.split("-").map(Number);
  return [year ?? 1970, month ?? 1, date ?? 1];
};

const isoDay = (year: number, month: number, date: number): string =>
  new Date(Date.UTC(year, month - 1, date)).toISOString().slice(0, 10);

const daysBefore = (day: string, days: number): string => {
  const [year, month, date] = dayParts(day);
  return new Date(Date.UTC(year, month - 1, date) - days * DAY_MS)
    .toISOString()
    .slice(0, 10);
};

/** The same date `months` months earlier; a date that month lacks is its last day. */
export const monthsBefore = (day: string, months: number): string => {
  const [year, month, date] = dayParts(day);
  const index = year * 12 + (month - 1) - months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = (index % 12) + 1;
  const lastDate = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  return isoDay(targetYear, targetMonth, Math.min(date, lastDate));
};

const firstDayOf = (parsed: Parsed, today: string): string => {
  if (parsed.kind === "all") return ALL_FROM_DAY;
  if (parsed.kind === "this_year") return `${today.slice(0, 4)}-01-01`;
  switch (parsed.unit) {
    case "day":
      return daysBefore(today, parsed.count - 1);
    case "week":
      return daysBefore(today, parsed.count * 7 - 1);
    case "month":
      return dayAfter(monthsBefore(today, parsed.count));
    case "year":
      return dayAfter(monthsBefore(today, parsed.count * 12));
  }
};

/**
 * The window a period means at `clock`. Throws on a period the schema would
 * have refused, so a caller that skipped the schema fails loudly.
 */
export const resolvePeriod = (period: string, clock: Clock): ResolvedWindow => {
  const parsed = parsePeriod(period);
  if (parsed === null) throw new Error("not a period the query tools know");
  const today = localClock(clock.now, clock.timeZone).day;
  const first = firstDayOf(parsed, today);
  const utc = clock.timeZone === "UTC";
  return {
    period,
    start: utc ? first : localDayBounds(first, clock.timeZone).start.toISOString(),
    end: utc
      ? today
      : new Date(localDayBounds(today, clock.timeZone).end.getTime() - 1).toISOString(),
    first_day: first,
    last_day: today,
    time_zone: clock.timeZone,
  };
};

/** Today in the clock's zone, "YYYY-MM-DD". */
export const todayOf = (clock: Clock): string =>
  localClock(clock.now, clock.timeZone).day;
