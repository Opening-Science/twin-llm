import { z } from "zod";

import {
  ORIGINS,
  replayEventSchema,
  replayNarrationSchema,
  replayReadingSchema,
} from "./items";
import { inLocalDay, isCalendarDay, isTimeZone, localDayBounds } from "./local-time";

/**
 * One person's local day, ready to replay: the readings, context events and
 * narration of that person on that day in that zone, and nothing else.
 *
 * The parser refuses an item of another person, day, zone or origin, a reading
 * outside the local day (a daylight-saving day is 23 or 25 hours long), an
 * event or narration that does not touch the day (one ending at its first
 * midnight does not), two items with one id, and two values of one stream at
 * one instant. A synthetic demonstration always carries its notice.
 */

/** Shown with every synthetic demonstration day. */
export const DEMO_NOTICE =
  "Synthetic demonstration: a made-up person and day, not a recording of anyone. Not advice.";

/** Which person, which local day, in which zone: what a replay selection names. */
export type ReplayKey = Readonly<{ subject_ref: string; day: string; time_zone: string }>;

/** A key to compare selections with: equal only for the same person, day and zone. */
export const replayKeyOf = (key: ReplayKey): string =>
  JSON.stringify([key.subject_ref, key.day, key.time_zone]);

/** True when an item is about exactly this person, day and zone. */
export const belongsTo = (item: ReplayKey, key: ReplayKey): boolean =>
  replayKeyOf(item) === replayKeyOf(key);

const dayShape = z
  .object({
    subject_ref: z.string().min(1).max(120),
    day: z.string().refine(isCalendarDay, "not a calendar day"),
    time_zone: z.string().refine(isTimeZone, "not a known time zone"),
    origin: z.enum(ORIGINS),
    /** DEMO_NOTICE on a synthetic day; null on a recording. */
    notice: z.string().min(1).nullable(),
    readings: z.array(replayReadingSchema),
    events: z.array(replayEventSchema),
    narrations: z.array(replayNarrationSchema),
  })
  .strict();

type DayShape = z.infer<typeof dayShape>;

const scopeIssues = (day: DayShape): readonly string[] =>
  [...day.readings, ...day.events, ...day.narrations].flatMap((item) => [
    ...(belongsTo(item, day)
      ? []
      : [`${item.id} is about another person, day or time zone`]),
    ...(item.origin === day.origin
      ? []
      : [`${item.id} is ${item.origin}, the day is ${day.origin}`]),
  ]);

const timeIssues = (day: DayShape): readonly string[] => {
  const bounds = localDayBounds(day.day, day.time_zone);
  // An event ending exactly at the day's first midnight belongs to the day
  // before; one that starts there (a tag at 00:00) belongs to this day.
  const touches = (from: string, to: string): boolean =>
    Date.parse(from) < bounds.end.getTime() &&
    (Date.parse(to) > bounds.start.getTime() ||
      Date.parse(from) >= bounds.start.getTime());
  return [
    ...day.readings.flatMap((reading) =>
      inLocalDay(new Date(reading.at), bounds)
        ? []
        : [`${reading.id} is outside ${day.day} in ${day.time_zone}`],
    ),
    ...[...day.events, ...day.narrations].flatMap((item) =>
      touches(item.from, item.to)
        ? []
        : [`${item.id} does not touch ${day.day} in ${day.time_zone}`],
    ),
  ];
};

const duplicates = (keys: readonly string[]): readonly string[] =>
  [...new Set(keys.filter((key, index) => keys.indexOf(key) !== index))].sort();

const uniquenessIssues = (day: DayShape): readonly string[] => [
  ...duplicates(
    [...day.readings, ...day.events, ...day.narrations].map((item) => item.id),
  ).map((id) => `two items share the id ${id}`),
  ...duplicates(
    day.readings.map(
      (reading) =>
        `${reading.stream === "glucose" ? `${reading.specimen} glucose` : reading.stream} ${new Date(reading.at).toISOString()}`,
    ),
  ).map((slot) => `two readings of one stream at one instant: ${slot}`),
];

const noticeIssues = (day: DayShape): readonly string[] =>
  day.origin === "synthetic_demo" && day.notice === null
    ? ["a synthetic demonstration day carries its notice"]
    : [];

/** The parser for a replay day. */
export const replayDaySchema = dayShape.superRefine((day, context) => {
  [
    ...noticeIssues(day),
    ...scopeIssues(day),
    ...timeIssues(day),
    ...uniquenessIssues(day),
  ].forEach((message) => context.addIssue({ code: "custom", message }));
});

export type ReplayDay = Readonly<z.infer<typeof replayDaySchema>>;
