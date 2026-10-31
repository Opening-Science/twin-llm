import { z } from "zod";

/**
 * When a scheduled task runs (#54): daily or weekly at a wall-clock time in
 * the person's time zone, or every N hours. Pure: no clock, no I/O; every
 * function takes the instant it reasons about.
 *
 * Wall-clock times follow the zone's daylight saving rules. A time that does
 * not exist on a spring-forward day (02:30 in Europe/Zurich) runs at the
 * same distance past the gap (03:30); a time that happens twice on a
 * fall-back day runs at the first of the two. An interval counts elapsed
 * time from the task's anchor, so it ignores the clock change.
 *
 * Catch-up: a task whose next run passed while the server was down runs once,
 * however many runs it missed, and its next run is the first one after now.
 */

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Every 1 to 168 hours; minutes so a short interval can be set from a script. */
export const MIN_INTERVAL_MINUTES = 1;
export const MAX_INTERVAL_MINUTES = 168 * 60;

export const isTimeZone = (zone: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
    return zone.length > 0;
  } catch {
    return false;
  }
};

export const scheduleSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("daily"),
    time: z.string().regex(TIME_PATTERN),
    timeZone: z.string().refine(isTimeZone),
  }),
  z.object({
    kind: z.literal("weekly"),
    /** 0 is Sunday, as `Date.getDay`. */
    weekday: z.number().int().min(0).max(6),
    time: z.string().regex(TIME_PATTERN),
    timeZone: z.string().refine(isTimeZone),
  }),
  z.object({
    kind: z.literal("interval"),
    minutes: z.number().int().min(MIN_INTERVAL_MINUTES).max(MAX_INTERVAL_MINUTES),
    timeZone: z.string().refine(isTimeZone),
  }),
]);

export type Schedule = Readonly<z.infer<typeof scheduleSchema>>;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

type Wall = Readonly<{ year: number; month: number; day: number; weekday: number }>;

const formatters = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  const known = formatters.get(timeZone);
  if (known !== undefined) return known;
  const made = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });
  formatters.set(timeZone, made);
  return made;
};

/** The zone's wall clock at `instant`, written as if it were a UTC time, in ms. */
export const wallClockMs = (instant: number, timeZone: string): number => {
  const parts = Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(new Date(instant))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return Date.UTC(
    parts.year ?? 0,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
};

const offsetAt = (instant: number, timeZone: string): number =>
  wallClockMs(instant - (instant % 1000), timeZone) - (instant - (instant % 1000));

/**
 * The instant at which the zone's clock reads `wall` (a wall time written as
 * UTC ms). In a spring-forward gap, the instant the gap's length later; when
 * the time happens twice, the earlier one.
 */
export const instantOfWallClock = (wall: number, timeZone: string): number => {
  const before = offsetAt(wall - DAY_MS, timeZone);
  const after = offsetAt(wall + DAY_MS, timeZone);
  const candidates = [wall - before, wall - after].filter(
    (instant) => wallClockMs(instant, timeZone) === wall,
  );
  return candidates.length > 0 ? Math.min(...candidates) : wall - before;
};

const wallDate = (instant: number, timeZone: string): Wall => {
  const wall = new Date(wallClockMs(instant, timeZone));
  return {
    year: wall.getUTCFullYear(),
    month: wall.getUTCMonth(),
    day: wall.getUTCDate(),
    weekday: wall.getUTCDay(),
  };
};

const timeParts = (time: string): Readonly<{ hour: number; minute: number }> => {
  const [hour, minute] = time.split(":").map(Number);
  return { hour: hour ?? 0, minute: minute ?? 0 };
};

/** The first time of day after `after`, on a day `accepts` allows; at most 8 days ahead. */
const nextAtTime = (
  after: number,
  time: string,
  timeZone: string,
  accepts: (weekday: number) => boolean,
): number => {
  const today = wallDate(after, timeZone);
  const { hour, minute } = timeParts(time);
  for (let offset = 0; offset <= 8; offset += 1) {
    const day = new Date(Date.UTC(today.year, today.month, today.day + offset));
    if (!accepts(day.getUTCDay())) continue;
    const wall = Date.UTC(
      day.getUTCFullYear(),
      day.getUTCMonth(),
      day.getUTCDate(),
      hour,
      minute,
    );
    const instant = instantOfWallClock(wall, timeZone);
    if (instant > after) return instant;
  }
  // Unreachable for a valid schedule: every weekday occurs within 8 days.
  throw new Error("no run time within 8 days");
};

/**
 * The first run strictly after `after`. `anchor` is when an interval counts
 * from (the task's creation); daily and weekly runs ignore it.
 */
export const nextRunAfter = (schedule: Schedule, after: Date, anchor: Date): Date => {
  const at = after.getTime();
  switch (schedule.kind) {
    case "daily":
      return new Date(nextAtTime(at, schedule.time, schedule.timeZone, () => true));
    case "weekly":
      return new Date(
        nextAtTime(
          at,
          schedule.time,
          schedule.timeZone,
          (weekday) => weekday === schedule.weekday,
        ),
      );
    case "interval": {
      const step = schedule.minutes * MINUTE_MS;
      const start = anchor.getTime();
      const passed = at < start ? -1 : Math.floor((at - start) / step);
      return new Date(start + (passed + 1) * step);
    }
  }
};

export type DueDecision =
  | Readonly<{ due: false }>
  | Readonly<{ due: true; scheduledFor: Date; missed: number; next: Date }>;

/**
 * Whether a task is due at `now`, and its next run once it has run. A task
 * that missed several runs (the server was down) is due once; `missed`
 * counts the runs it skips.
 */
export const dueDecision = (
  schedule: Schedule,
  nextRunAt: Date | null,
  now: Date,
  anchor: Date,
): DueDecision => {
  if (nextRunAt === null || nextRunAt.getTime() > now.getTime()) return { due: false };
  const next = nextRunAfter(schedule, now, anchor);
  const countMissed = (from: Date, count: number): number => {
    const following = nextRunAfter(schedule, from, anchor);
    return following.getTime() > now.getTime() || count >= 1000
      ? count
      : countMissed(following, count + 1);
  };
  return { due: true, scheduledFor: nextRunAt, missed: countMissed(nextRunAt, 0), next };
};

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export const weekdayName = (weekday: number): string => WEEKDAYS[weekday] ?? "";

/** The schedule in words: "Daily at 08:00", "Mondays at 07:30", "Every 6 hours". */
export const describeSchedule = (schedule: Schedule): string => {
  switch (schedule.kind) {
    case "daily":
      return `Daily at ${schedule.time}`;
    case "weekly":
      return `${weekdayName(schedule.weekday)}s at ${schedule.time}`;
    case "interval": {
      const { minutes } = schedule;
      if (minutes % 60 === 0) {
        const hours = minutes / 60;
        return hours === 1 ? "Every hour" : `Every ${String(hours)} hours`;
      }
      return minutes === 1 ? "Every minute" : `Every ${String(minutes)} minutes`;
    }
  }
};
