import { type ReplayEvent, type ReplayReading } from "./items";
import {
  dayAfter,
  dayBefore,
  localClock,
  localDayBounds,
  localInstant,
  minutesBetween,
} from "./local-time";
import { DEMO_NOTICE, type ReplayDay, replayDaySchema } from "./replay-day";
import { type PersonRecord } from "./zones";

/**
 * Deterministic synthetic demonstration days for the replay (#862). Made up,
 * not a recording of anyone; every item says `synthetic_demo` and every day
 * carries the notice. No randomness: the same call gives the same day.
 *
 * Person A, in Europe/Berlin:
 *
 * - ten days, 20 to 29 October 2026, each with its own nightly resting heart
 *   rate and HRV; 25 October is the autumn clock change, a 25-hour day;
 * - 27 October is the reference day: all eight heart-rate and all eight
 *   glucose phases of #860, a missing stretch of sensor glucose, a blood
 *   glucose value the person entered, and heart rate every minute around the
 *   end of the run (every 15 minutes elsewhere);
 * - 22 October has nothing recorded; on 23 October the ring stops syncing at
 *   20:00, so later heart rate is stale; on 28 October no glucose sensor is
 *   worn and no steps or activity are recorded;
 * - 21 nights before the ten days with nightly values only, enough history
 *   for a personal baseline.
 *
 * Person B, in Europe/Berlin: four days, 26 to 29 October, and no history
 * before them, so no baseline can be formed.
 *
 * Each person has a record (`demoPerson`): A is 34, so the heart-rate zones
 * can be estimated; B's record has no age, so they cannot.
 */

export const DEMO_TIME_ZONE = "Europe/Berlin";
export const DEMO_PERSON_A = "synthetic-replay-a";
export const DEMO_PERSON_B = "synthetic-replay-b";
export const DEMO_REFERENCE_DAY = "2026-10-27";
export const DEMO_DST_DAY = "2026-10-25";

/** The synthetic people's records: made up, like their days. */
const PEOPLE: readonly PersonRecord[] = [
  { subject_ref: DEMO_PERSON_A, age_years: 34 },
  { subject_ref: DEMO_PERSON_B, age_years: null },
];

/** A demo person's record, or null when the demo has no such person. */
export const demoPerson = (subjectRef: string): PersonRecord | null =>
  PEOPLE.find((one) => one.subject_ref === subjectRef) ?? null;

const RING = { kind: "device", name: "Synthetic ring (demo)" } as const;
const SENSOR = { kind: "device", name: "Synthetic glucose sensor (demo)" } as const;
const PERSON = { kind: "person", name: "Entered by the demo person" } as const;

type DayKind =
  /** Every stream, all day. */
  | "full"
  /** Nothing recorded at all. */
  | "nothing"
  /** The ring stops syncing at 20:00: heart rate and steps end there. */
  | "stale"
  /** No glucose sensor worn, no steps or activity recorded: heart rate, nightly values, sleep and tags. */
  | "partial"
  /** Only the night's resting heart rate and HRV: history for a baseline. */
  | "nightly";

type DayPlan = Readonly<{
  subject: string;
  day: string;
  kind: DayKind;
  restingPerMin: number | null;
  hrvMs: number | null;
  run: boolean;
  stillRise: boolean;
  /** The reference day: one-minute heart rate around the run, a sensor gap, an entered blood value. */
  reference: boolean;
}>;

const plan = (
  subject: string,
  day: string,
  kind: DayKind,
  restingPerMin: number | null,
  hrvMs: number | null,
  options: Partial<Pick<DayPlan, "run" | "stillRise" | "reference">> = {},
): DayPlan => ({
  subject,
  day,
  kind,
  restingPerMin,
  hrvMs,
  run: options.run ?? false,
  stillRise: options.stillRise ?? false,
  reference: options.reference ?? false,
});

const A = DEMO_PERSON_A;
const B = DEMO_PERSON_B;

/** The ten days of person A: distinct nights, one elevated night alone, then two in a row. */
const TEN_DAYS_A: readonly DayPlan[] = [
  plan(A, "2026-10-20", "full", 54, 62),
  plan(A, "2026-10-21", "full", 55, 58, { run: true }),
  plan(A, "2026-10-22", "nothing", null, null),
  plan(A, "2026-10-23", "stale", 53, 65),
  plan(A, "2026-10-24", "full", 61, 48, { stillRise: true }),
  plan(A, "2026-10-25", "full", 56, 57, { run: true }),
  plan(A, "2026-10-26", "full", 60, 50),
  plan(A, "2026-10-27", "full", 62, 46, { run: true, stillRise: true, reference: true }),
  plan(A, "2026-10-28", "partial", 57, 55),
  plan(A, "2026-10-29", "full", 54, 60, { run: true }),
];

/** 21 nights before the ten days, nightly values only: 52 to 56 /min, 56 to 64 ms. */
const HISTORY_A: readonly DayPlan[] = Array.from({ length: 21 }, (_, index) => {
  const day = Array.from({ length: 21 - index }).reduce<string>(
    (current) => dayBefore(current),
    "2026-10-20",
  );
  return plan(A, day, "nightly", 52 + ((index * 3) % 5), 56 + ((index * 5) % 9));
});

const DAYS_B: readonly DayPlan[] = [
  plan(B, "2026-10-26", "full", 58, 44),
  plan(B, "2026-10-27", "full", 59, 42, { run: true }),
  plan(B, "2026-10-28", "full", 57, 45),
  plan(B, "2026-10-29", "full", 60, 41, { stillRise: true }),
];

const PLANS: readonly DayPlan[] = [...HISTORY_A, ...TEN_DAYS_A, ...DAYS_B];

/** The ten days of the comparison, in order. */
export const DEMO_TEN_DAYS: readonly string[] = TEN_DAYS_A.map((one) => one.day);

// ─── the day's shape, in minutes of the wall clock ─────────────────────────

type Keyframe = readonly [minute: number, value: number];

const at = (time: string): number => {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
};

const RUN = { from: at("18:00"), to: at("18:45") };
const WALK = { from: at("12:30"), to: at("13:15") };
const STILL_RISE = { from: at("15:00"), to: at("15:45") };
const WAKE = at("06:30");
const BED = at("22:45");

/** Heart rate for a resting rate of 54 /min; shifted by the night's resting rate. */
const heartFrames = (one: DayPlan): readonly Keyframe[] =>
  [
    [0, 55],
    [at("04:00"), 52],
    [at("06:15"), 54],
    [WAKE, 70],
    [at("07:00"), 64],
    [at("08:00"), 62],
    [at("12:15"), 66],
    [WALK.from, 96],
    [WALK.to, 98],
    [at("13:30"), 72],
    [at("14:45"), 66],
    ...(one.stillRise
      ? ([
          [STILL_RISE.from, 106],
          [STILL_RISE.to, 108],
          [at("16:00"), 70],
        ] as const)
      : []),
    [at("17:45"), 68],
    ...(one.run
      ? ([
          [RUN.from, 150],
          [at("18:30"), 162],
          [RUN.to, 160],
          [RUN.to + 1, 142],
          [at("19:00"), 92],
          [at("19:15"), 74],
        ] as const)
      : []),
    [at("19:30"), 70],
    [at("22:00"), 64],
    [BED, 58],
    [1440, 55],
  ] satisfies readonly Keyframe[];

/** Sensor glucose: dawn rise, breakfast, lunch and a walk, a snack, a dip on a run, dinner. */
const glucoseFrames = (one: DayPlan): readonly Keyframe[] =>
  [
    [0, 92],
    [at("04:00"), 88],
    [WAKE, 101],
    [at("07:30"), 100],
    [at("08:15"), 136],
    [at("09:30"), 102],
    [at("12:15"), 96],
    [WALK.from + 15, 124],
    [at("13:30"), 104],
    [at("16:00"), 98],
    [at("16:30"), 115],
    [at("17:15"), 100],
    [RUN.from, 99],
    ...(one.run ? ([[RUN.to, 80]] as const) : []),
    [at("19:30"), 88],
    [at("20:15"), 152],
    [at("21:30"), 112],
    [BED, 98],
    [1440, 94],
  ] satisfies readonly Keyframe[];

const valueAt = (frames: readonly Keyframe[], minute: number): number => {
  const after = frames.findIndex(([frame]) => frame >= minute);
  const right = frames[after] ?? frames[frames.length - 1] ?? [0, 0];
  const left = frames[after - 1] ?? right;
  if (right[0] === left[0]) return right[1];
  return left[1] + ((right[1] - left[1]) * (minute - left[0])) / (right[0] - left[0]);
};

/** A small fixed wobble, -2 to 2, so a series is not a ruler. */
const wobble = (index: number): number => ((index * 7919) % 5) - 2;

const stepsAt = (one: DayPlan, minute: number, index: number): number => {
  if (minute < WAKE || minute >= BED) return 0;
  if (minute < WAKE + 30) return 250;
  if (minute >= WALK.from && minute < WALK.to) return 1500 + wobble(index) * 20;
  if (one.run && minute >= RUN.from && minute < RUN.to) return 2400 + wobble(index) * 30;
  if (one.stillRise && minute >= STILL_RISE.from && minute < STILL_RISE.to) return 15;
  return 120 + wobble(index) * 10;
};

// ─── items ─────────────────────────────────────────────────────────────────

const scopeOf = (one: DayPlan) =>
  ({
    subject_ref: one.subject,
    day: one.day,
    time_zone: DEMO_TIME_ZONE,
    origin: "synthetic_demo",
  }) as const;

/** Every 15 minutes from local midnight to the next, 92, 96 or 100 instants. */
const quarterHours = (day: string): readonly Date[] => {
  const bounds = localDayBounds(day, DEMO_TIME_ZONE);
  return Array.from(
    { length: bounds.hours * 4 },
    (_, index) => new Date(bounds.start.getTime() + index * 15 * 60_000),
  );
};

const minuteOfClock = (instant: Date): number =>
  at(localClock(instant, DEMO_TIME_ZONE).time);

const iso = (instant: Date): string => instant.toISOString();

const ONE_MINUTE_FROM = at("18:30");
const ONE_MINUTE_TO = at("19:15");
const SENSOR_GAP = { from: at("10:00"), to: at("11:00") };

const heartReading = (
  one: DayPlan,
  instant: Date,
  index: number,
  intervalMin: number,
): ReplayReading => ({
  ...scopeOf(one),
  id: `hr-${iso(instant)}`,
  stream: "heart_rate",
  unit: "/min",
  timing: "sample",
  at: iso(instant),
  interval_min: intervalMin,
  provenance: "measured",
  source: RING,
  availability: "available",
  value: Math.round(
    valueAt(heartFrames(one), minuteOfClock(instant)) +
      (one.restingPerMin ?? 54) -
      54 +
      wobble(index),
  ),
});

const heartReadings = (one: DayPlan, until: number): readonly ReplayReading[] => {
  const fine = (minute: number): boolean =>
    one.reference && minute >= ONE_MINUTE_FROM && minute < ONE_MINUTE_TO;
  const quarter = quarterHours(one.day)
    .map((instant, index) => ({ instant, index }))
    .filter(({ instant }) => {
      const minute = minuteOfClock(instant);
      return minute < until && !fine(minute);
    })
    .map(({ instant, index }) => heartReading(one, instant, index, 15));
  const start = localInstant(one.day, "18:30", DEMO_TIME_ZONE);
  const minutes = one.reference
    ? Array.from({ length: ONE_MINUTE_TO - ONE_MINUTE_FROM }, (_, index) =>
        heartReading(one, new Date(start.getTime() + index * 60_000), index, 1),
      )
    : [];
  return [...quarter, ...minutes].sort((a, b) => a.at.localeCompare(b.at));
};

const stepReadings = (one: DayPlan, until: number): readonly ReplayReading[] =>
  quarterHours(one.day).flatMap((instant, index) => {
    const minute = minuteOfClock(instant);
    if (minute >= until) return [];
    return [
      {
        ...scopeOf(one),
        id: `steps-${iso(instant)}`,
        stream: "steps",
        unit: "steps",
        timing: "interval",
        at: iso(instant),
        interval_min: 15,
        provenance: "measured",
        source: RING,
        availability: "available",
        value: stepsAt(one, minute, index),
      } satisfies ReplayReading,
    ];
  });

const glucoseReadings = (one: DayPlan): readonly ReplayReading[] =>
  quarterHours(one.day).map((instant, index): ReplayReading => {
    const minute = minuteOfClock(instant);
    const base = {
      ...scopeOf(one),
      id: `sg-${iso(instant)}`,
      stream: "glucose",
      unit: "mg/dL",
      specimen: "sensor",
      timing: "sample",
      at: iso(instant),
      interval_min: 15,
      provenance: "measured",
      source: SENSOR,
    } as const;
    return one.reference && minute >= SENSOR_GAP.from && minute < SENSOR_GAP.to
      ? {
          ...base,
          availability: "missing",
          value: null,
          missing_reason: "New sensor warming up",
        }
      : {
          ...base,
          availability: "available",
          value: Math.round(valueAt(glucoseFrames(one), minute) + wobble(index)),
        };
  });

/** A finger-prick value the demo person typed in before breakfast. */
const enteredBlood = (one: DayPlan): readonly ReplayReading[] =>
  one.reference
    ? [
        {
          ...scopeOf(one),
          id: "bg-entered-breakfast",
          stream: "glucose",
          unit: "mg/dL",
          specimen: "blood",
          timing: "observation",
          at: iso(localInstant(one.day, "07:25", DEMO_TIME_ZONE)),
          interval_min: 1,
          provenance: "entered",
          source: PERSON,
          availability: "available",
          value: 98,
        },
      ]
    : [];

/** The device's nightly values, at the end of the night they stand for. */
const nightlyReadings = (one: DayPlan): readonly ReplayReading[] => {
  const from = localInstant(dayBefore(one.day), "22:45", DEMO_TIME_ZONE);
  const to = localInstant(one.day, "06:30", DEMO_TIME_ZONE);
  const night = {
    ...scopeOf(one),
    at: iso(to),
    timing: "night",
    interval_min: minutesBetween(from, to),
    provenance: "measured",
    source: RING,
    availability: "available",
  } as const;
  return [
    ...(one.restingPerMin === null
      ? []
      : [
          {
            ...night,
            id: "night-resting-hr",
            stream: "resting_heart_rate",
            unit: "/min",
            value: one.restingPerMin,
          } as const,
        ]),
    ...(one.hrvMs === null
      ? []
      : [
          {
            ...night,
            id: "night-hrv",
            stream: "hrv_rmssd",
            unit: "ms",
            value: one.hrvMs,
          } as const,
        ]),
  ];
};

const event = (
  one: DayPlan,
  id: string,
  fields: Readonly<
    Pick<ReplayEvent, "kind" | "label" | "provenance" | "source"> &
      Partial<Pick<ReplayEvent, "activity" | "meal">>
  >,
  from: Date,
  to: Date,
): ReplayEvent => ({ ...scopeOf(one), id, ...fields, from: iso(from), to: iso(to) });

const local = (day: string, time: string): Date =>
  localInstant(day, time, DEMO_TIME_ZONE);

const sleepEvents = (one: DayPlan): readonly ReplayEvent[] => [
  event(
    one,
    "sleep-night-before",
    { kind: "sleep", label: "Sleep", provenance: "measured", source: RING },
    local(dayBefore(one.day), "22:45"),
    local(one.day, "06:30"),
  ),
  ...(one.kind === "stale"
    ? []
    : [
        event(
          one,
          "sleep-night-after",
          { kind: "sleep", label: "Sleep", provenance: "measured", source: RING },
          local(one.day, "22:45"),
          local(dayAfter(one.day), "06:30"),
        ),
      ]),
];

const activityEvents = (one: DayPlan): readonly ReplayEvent[] => [
  event(
    one,
    "walk",
    {
      kind: "activity",
      activity: "walk",
      label: "Walk",
      provenance: "measured",
      source: RING,
    },
    local(one.day, "12:30"),
    local(one.day, "13:15"),
  ),
  ...(one.run
    ? [
        event(
          one,
          "run",
          {
            kind: "activity",
            activity: "run",
            label: "Run",
            provenance: "measured",
            source: RING,
          },
          local(one.day, "18:00"),
          local(one.day, "18:45"),
        ),
      ]
    : []),
];

const MEAL_TIMES = [
  ["breakfast", "Breakfast", "07:30", "07:50"],
  ["lunch", "Lunch", "12:00", "12:25"],
  ["snack", "Snack", "16:00", "16:10"],
  ["dinner", "Dinner", "19:30", "20:00"],
] as const;

/** Tags the demo person entered: the four meals and winding down before bed. */
const tagEvents = (one: DayPlan): readonly ReplayEvent[] => [
  ...MEAL_TIMES.map(([meal, label, from, to]) =>
    event(
      one,
      `tag-${meal}`,
      { kind: "meal", meal, label, provenance: "entered", source: PERSON },
      local(one.day, from),
      local(one.day, to),
    ),
  ),
  event(
    one,
    "tag-wind-down",
    { kind: "tag", label: "Winding down", provenance: "entered", source: PERSON },
    local(one.day, "22:00"),
    local(one.day, "22:45"),
  ),
];

const STALE_FROM = at("20:00");
const ALL_DAY = 1441;

const build = (one: DayPlan): ReplayDay => {
  const nightly = nightlyReadings(one);
  const shape = (() => {
    switch (one.kind) {
      case "nothing":
        return { readings: [], events: [] };
      case "nightly":
        return { readings: nightly, events: [] };
      case "partial":
        return {
          readings: [...nightly, ...heartReadings(one, ALL_DAY)],
          events: [...sleepEvents(one), ...tagEvents(one)],
        };
      case "stale":
        return {
          readings: [
            ...nightly,
            ...heartReadings(one, STALE_FROM),
            ...stepReadings(one, STALE_FROM),
            ...glucoseReadings(one),
          ],
          events: [...sleepEvents(one), ...activityEvents(one), ...tagEvents(one)],
        };
      case "full":
        return {
          readings: [
            ...nightly,
            ...heartReadings(one, ALL_DAY),
            ...stepReadings(one, ALL_DAY),
            ...glucoseReadings(one),
            ...enteredBlood(one),
          ],
          events: [...sleepEvents(one), ...activityEvents(one), ...tagEvents(one)],
        };
    }
  })();
  return replayDaySchema.parse({
    ...scopeOf(one),
    notice: DEMO_NOTICE,
    readings: shape.readings,
    events: shape.events,
    narrations: [],
  });
};

/** One demo day, or null when the demo has no such person or day: never another day's values. */
export const demoReplayDay = (subjectRef: string, day: string): ReplayDay | null => {
  const found = PLANS.find((one) => one.subject === subjectRef && one.day === day);
  return found === undefined ? null : build(found);
};

/** Every demo day of a person, oldest first: the history and the days to compare. */
export const demoReplayDays = (subjectRef: string): readonly ReplayDay[] =>
  PLANS.filter((one) => one.subject === subjectRef)
    .sort((a, b) => a.day.localeCompare(b.day))
    .map(build);
