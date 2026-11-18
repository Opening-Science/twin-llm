import { type TwinFocusId } from "@/packages/anatomy/twin-focus";

import { DAY_THRESHOLDS, type DayThresholds, type GlucoseProfile } from "../day-beats";
import { seriesOf } from "./at-time";
import { type Baseline } from "./baseline";
import {
  type AvailableReading,
  isAvailable,
  type NARRATION_TOPICS,
  type ReplayEvent,
  type ReplayNarration,
  replayNarrationSchema,
} from "./items";
import { localDayBounds, localInstant } from "./local-time";
import { recoveryAfter } from "./recovery";
import { type ReplayDay } from "./replay-day";
import {
  decide,
  GLUCOSE_MEAL_RISE,
  glucosePast,
  glucoseThresholdRule,
  HEART_NEAR_BASELINE,
  HEART_NOT_JUDGED,
  HEART_RECOVERY,
  heartStillRule,
  MEAL_RISE_NOTABLE_MG_DL,
  type RuleOutcome,
  type StatusResult,
  type StatusRule,
} from "./status-rules";

/**
 * The story phases of a day: stretches of heart rate and of glucose that the
 * evidence supports, each with the rule that made it, the items it rests on,
 * its status and, where it helps, a narrated explanation. Pure, free of I/O.
 *
 * A phase exists only when its evidence does: a recorded sleep, walk or run,
 * a tag the person entered, and readings of its own stream inside it. Between
 * phases nothing is said; a day without that evidence has fewer phases, never
 * invented ones. The sixteen phases of #860 all appear on the demo reference
 * day.
 */

export const HEART_PHASES = [
  "sleep",
  "waking",
  "resting",
  "walking",
  "elevated_still",
  "running",
  "recovery",
  "winding_down",
] as const;
export type HeartPhase = (typeof HEART_PHASES)[number];

export const GLUCOSE_PHASES = [
  "overnight_fasting",
  "dawn",
  "breakfast",
  "lunch_with_walking",
  "lunch",
  "snack",
  "running",
  "dinner",
  "return_to_sleep",
] as const;
export type GlucosePhase = (typeof GLUCOSE_PHASES)[number];

const HEART_LABELS: Readonly<Record<HeartPhase, string>> = {
  sleep: "Sleep",
  waking: "Waking",
  resting: "Resting",
  walking: "Walking",
  elevated_still: "Raised heart rate while still",
  running: "Running",
  recovery: "Recovery",
  winding_down: "Winding down and sleep",
};

const GLUCOSE_LABELS: Readonly<Record<GlucosePhase, string>> = {
  overnight_fasting: "Overnight fasting",
  dawn: "Before waking",
  breakfast: "Breakfast",
  lunch_with_walking: "Lunch and a walk",
  lunch: "Lunch",
  snack: "Snack",
  running: "Running",
  dinner: "Dinner",
  return_to_sleep: "Back to sleep",
};

/** A peak or a low within a phase: derived, never the reading at the cursor. */
export type PhaseExtreme = Readonly<{
  kind: "highest" | "lowest";
  value: number;
  unit: "/min" | "mg/dL";
  at: string;
  reading_id: string;
  provenance: "derived";
}>;

type PhaseBase = Readonly<{
  id: string;
  label: string;
  from: string;
  to: string;
  provenance: "derived";
  /** Why this stretch is this phase. */
  rule: Readonly<{ id: string; text: string }>;
  evidence: readonly string[];
  extreme: PhaseExtreme | null;
  status: StatusResult;
  narration: ReplayNarration | null;
}>;

export type StoryPhase = PhaseBase &
  (
    | Readonly<{ stream: "heart_rate"; specimen: null; phase: HeartPhase }>
    | Readonly<{ stream: "glucose"; specimen: "blood" | "sensor"; phase: GlucosePhase }>
  );

export type PhaseOptions = Readonly<{
  /** The personal resting baseline (`personalBaseline`), or why there is none. */
  restingBaseline: Baseline;
  profile?: GlucoseProfile;
  thresholds?: DayThresholds;
}>;

/** Under this many steps in 15 minutes a person counts as still. */
export const STILL_STEPS_PER_15_MIN = 50;
/** Up to this many steps in 15 minutes the hour after waking can count as resting. */
export const RESTING_STEPS_PER_15_MIN = 300;
/** A rise in the night from the lowest glucose to waking that counts as a dawn rise. */
export const DAWN_RISE_MG_DL = 10;
/** The tag that starts winding down, as the demo person enters it; no other word does. */
export const WIND_DOWN_TAG = "Winding down";
/** How long a meal's phase lasts unless the next meal comes first. */
export const MEAL_WINDOW_MIN = 90;

const MINUTE = 60_000;
const ms = (iso: string): number => Date.parse(iso);
const iso = (time: number): string => new Date(time).toISOString();

const between =
  (from: number, to: number, inclusive = false) =>
  (reading: Readonly<{ at: string }>): boolean =>
    ms(reading.at) >= from && (inclusive ? ms(reading.at) <= to : ms(reading.at) < to);

const overlaps = (event: ReplayEvent, at: number): boolean =>
  ms(event.from) <= at && at < ms(event.to);

const extremeOf = (
  readings: readonly AvailableReading[],
  kind: "highest" | "lowest",
  unit: "/min" | "mg/dL",
): PhaseExtreme | null => {
  const chosen = readings.reduce<AvailableReading | null>(
    (best, reading) =>
      best === null ||
      (kind === "highest" ? reading.value > best.value : reading.value < best.value)
        ? reading
        : best,
    null,
  );
  return chosen === null
    ? null
    : {
        kind,
        value: chosen.value,
        unit,
        at: chosen.at,
        reading_id: chosen.id,
        provenance: "derived",
      };
};

const medianOf = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

type Narrated = Readonly<{
  topic: (typeof NARRATION_TOPICS)[number];
  focus: TwinFocusId;
  text: string;
}>;

const USUALLY = "This describes what usually happens, not a measurement.";

const HEART_NARRATION: Partial<Record<HeartPhase, Narrated>> = {
  sleep: {
    topic: "heart_rate",
    focus: "heart",
    text: `In sleep the heart usually slows to its lowest pace of the day. ${USUALLY}`,
  },
  elevated_still: {
    topic: "heart_rate",
    focus: "heart",
    text: "The heart can speed up without movement, for example with stress, caffeine or illness. The data alone cannot say why.",
  },
  running: {
    topic: "heart_rate",
    focus: "heart",
    text: `The heart beats faster to move more blood to working muscles. ${USUALLY}`,
  },
  recovery: {
    topic: "heart_rate",
    focus: "heart",
    text: `After exercise the heart slows step by step as the body settles. ${USUALLY}`,
  },
};

const INSULIN: Narrated = {
  topic: "insulin",
  focus: "pancreas",
  text: "After a meal the pancreas usually releases insulin, which helps cells take up sugar. Insulin is not measured here.",
};

const GLUCOSE_NARRATION: Partial<Record<GlucosePhase, Narrated>> = {
  dawn: {
    topic: "glucose",
    focus: "liver",
    text: `Before waking the liver usually releases stored sugar, so glucose can climb without food. ${USUALLY}`,
  },
  breakfast: INSULIN,
  lunch: INSULIN,
  snack: INSULIN,
  dinner: INSULIN,
  lunch_with_walking: {
    topic: "glucose",
    focus: "musculoskeletal",
    text: `Walking after a meal helps muscles take up sugar from the blood. ${USUALLY}`,
  },
  running: {
    topic: "glucose",
    focus: "musculoskeletal",
    text: `Working muscles take up sugar during exercise, so glucose can dip. ${USUALLY}`,
  },
};

const narrationFor = (
  day: ReplayDay,
  id: string,
  from: string,
  to: string,
  narrated: Narrated | undefined,
): ReplayNarration | null =>
  narrated === undefined
    ? null
    : replayNarrationSchema.parse({
        subject_ref: day.subject_ref,
        day: day.day,
        time_zone: day.time_zone,
        origin: day.origin,
        id: `n-${id}`,
        provenance: "narrated",
        source: { kind: "twin_llm", name: "TwinLLM" },
        ...narrated,
        from,
        to,
      });

type Window = Readonly<{
  from: number;
  to: number;
  /** Count a reading exactly at `to` as inside. */
  inclusive?: boolean;
  rule: Readonly<{ id: string; text: string }>;
  events: readonly string[];
}>;

export const storyPhases = (
  day: ReplayDay,
  options: PhaseOptions,
): readonly StoryPhase[] => {
  const thresholds = options.thresholds ?? DAY_THRESHOLDS;
  const profile = options.profile ?? "without_diabetes";
  const baseline = options.restingBaseline;
  const bounds = localDayBounds(day.day, day.time_zone);
  const start = bounds.start.getTime();
  const end = bounds.end.getTime();
  // Local noon, not twelve hours after midnight: on a clock-change day those differ by an hour.
  const noon = localInstant(day.day, "12:00", day.time_zone).getTime();

  const heart = seriesOf(day, { stream: "heart_rate" }).filter(isAvailable);
  const steps = seriesOf(day, { stream: "steps" }).filter(isAvailable);
  const specimen = (["sensor", "blood"] as const).find((one) =>
    seriesOf(day, { stream: "glucose", specimen: one }).some(isAvailable),
  );
  const glucose =
    specimen === undefined
      ? []
      : seriesOf(day, { stream: "glucose", specimen }).filter(isAvailable);

  const byStart = (a: ReplayEvent, b: ReplayEvent): number => ms(a.from) - ms(b.from);
  const sleeps = day.events.filter((event) => event.kind === "sleep").sort(byStart);
  const morning = sleeps.find((event) => ms(event.to) > start && ms(event.to) <= noon);
  const evening = sleeps.find((event) => ms(event.from) >= noon && ms(event.from) < end);
  const activities = day.events
    .filter((event) => event.kind === "activity")
    .sort(byStart);
  const walks = activities.filter((event) => event.activity === "walk");
  const runs = activities.filter((event) => event.activity === "run");
  const meals = day.events.filter((event) => event.kind === "meal").sort(byStart);
  const windDown = day.events.find(
    (event) =>
      event.kind === "tag" &&
      event.label.trim().toLowerCase() === WIND_DOWN_TAG.toLowerCase(),
  );
  const moving = (at: number): boolean => activities.some((event) => overlaps(event, at));
  const stepsAt = (at: number): AvailableReading | undefined =>
    steps.find(
      (reading) =>
        ms(reading.at) <= at && at < ms(reading.at) + reading.interval_min * MINUTE,
    );

  // ─── heart rate ───────────────────────────────────────────────────────────

  const heartStatus = (
    phase: HeartPhase,
    readings: readonly AvailableReading[],
    window: Window,
  ): StatusResult => {
    const ids = readings.map((reading) => reading.id);
    const still = heartStillRule(thresholds);
    const notJudged = (): StatusResult =>
      decide(day.origin, HEART_NOT_JUDGED, {
        status: "usual",
        evidence: ids,
        reason: "Heart rate in this phase is not judged by its height.",
      });
    switch (phase) {
      case "sleep":
      case "resting": {
        if (baseline.state !== "available") {
          return decide(day.origin, HEART_NEAR_BASELINE, {
            status: "insufficient_data",
            evidence: ids,
            reason: `No personal resting baseline: ${baseline.text}`,
          });
        }
        const middle = medianOf(readings.map((reading) => reading.value));
        return decide(day.origin, HEART_NEAR_BASELINE, {
          status: middle <= baseline.median + 10 ? "usual" : "notable",
          evidence: [...ids, ...baseline.evidence],
          reason: `Median ${middle} /min against a resting baseline of ${baseline.median} /min.`,
        });
      }
      case "elevated_still":
        return decide(day.origin, still, {
          status: "worth_a_look",
          evidence: ids,
          reason: `Up to ${Math.max(...readings.map((reading) => reading.value))} /min with fewer than ${STILL_STEPS_PER_15_MIN} steps per 15 minutes.`,
        });
      case "recovery": {
        const run = runs.find((event) => window.events.includes(event.id));
        const recovery = run === undefined ? null : recoveryAfter(day, run, thresholds);
        const outcome: RuleOutcome =
          recovery === null || recovery.before_per_min === null
            ? {
                status: "insufficient_data",
                evidence: ids,
                reason: "No heart rate before the run to recover to.",
              }
            : recovery.back_within_min === null || recovery.back_within_min > 60
              ? {
                  status: "notable",
                  evidence: recovery.evidence,
                  reason: "Not back within the recovery band within an hour.",
                }
              : {
                  status: "usual",
                  evidence: recovery.evidence,
                  reason: `Back within ${recovery.band_per_min} /min of ${recovery.before_per_min} /min by ${recovery.back_within_min} minutes after the run, read ${recovery.resolution_min} minute(s) apart.`,
                };
        return decide(day.origin, HEART_RECOVERY, outcome);
      }
      default:
        return notJudged();
    }
  };

  const HIGHEST_HEART: ReadonlySet<HeartPhase> = new Set([
    "waking",
    "walking",
    "elevated_still",
    "running",
  ]);

  const heartPhase = (phase: HeartPhase, window: Window): StoryPhase | null => {
    const readings = heart.filter(between(window.from, window.to, window.inclusive));
    if (readings.length === 0) return null;
    const from = iso(window.from);
    const to = iso(window.to);
    const id = `heart_rate-${phase}-${from}`;
    return {
      id,
      stream: "heart_rate",
      specimen: null,
      phase,
      label: HEART_LABELS[phase],
      from,
      to,
      provenance: "derived",
      rule: window.rule,
      evidence: [...window.events, ...readings.map((reading) => reading.id)],
      extreme: extremeOf(
        readings,
        HIGHEST_HEART.has(phase) ? "highest" : "lowest",
        "/min",
      ),
      status: heartStatus(phase, readings, window),
      narration: narrationFor(day, id, from, to, HEART_NARRATION[phase]),
    };
  };

  const elevatedRuns = (): readonly (readonly AvailableReading[])[] =>
    heart.reduce<readonly (readonly AvailableReading[])[]>((groups, reading, index) => {
      const stepReading = stepsAt(ms(reading.at));
      const raised =
        reading.value > thresholds.heartRateStillAbovePerMin &&
        stepReading !== undefined &&
        stepReading.value < STILL_STEPS_PER_15_MIN &&
        !moving(ms(reading.at));
      if (!raised) return groups;
      const last = groups.at(-1);
      const previous = heart[index - 1];
      return last !== undefined && previous !== undefined && last.at(-1) === previous
        ? [...groups.slice(0, -1), [...last, reading]]
        : [...groups, [reading]];
    }, []);

  const heartWindows: readonly (readonly [HeartPhase, Window])[] = [
    ...(morning === undefined
      ? []
      : ([
          [
            "sleep",
            {
              from: Math.max(start, ms(morning.from)),
              to: ms(morning.to),
              rule: { id: "phase_sleep", text: "Recorded sleep before waking." },
              events: [morning.id],
            },
          ],
          [
            "waking",
            {
              from: ms(morning.to),
              to: ms(morning.to) + 30 * MINUTE,
              rule: {
                id: "phase_waking",
                text: "The first half hour after recorded sleep ends.",
              },
              events: [morning.id],
            },
          ],
        ] as const)),
    ...(() => {
      if (morning === undefined) return [];
      const from = ms(morning.to) + 30 * MINUTE;
      const to = from + 60 * MINUTE;
      const stepReadings = steps.filter(between(from, to));
      const resting =
        stepReadings.length > 0 &&
        stepReadings.every((reading) => reading.value <= RESTING_STEPS_PER_15_MIN) &&
        !activities.some((event) => ms(event.from) < to && ms(event.to) > from);
      return resting
        ? ([
            [
              "resting",
              {
                from,
                to,
                rule: {
                  id: "phase_resting",
                  text: `The hour after waking, with steps recorded and at most ${RESTING_STEPS_PER_15_MIN} per 15 minutes, and no walk or run.`,
                },
                events: stepReadings.map((reading) => reading.id),
              },
            ],
          ] as const)
        : [];
    })(),
    ...walks.map(
      (walk) =>
        [
          "walking",
          {
            from: ms(walk.from),
            to: ms(walk.to),
            rule: { id: "phase_walking", text: "A walk the device recorded." },
            events: [walk.id],
          },
        ] as const,
    ),
    ...elevatedRuns().map((group) => {
      const first = group[0];
      const last = group[group.length - 1];
      const from = first === undefined ? start : ms(first.at);
      const to = last === undefined ? start : ms(last.at) + last.interval_min * MINUTE;
      return [
        "elevated_still",
        {
          from,
          to,
          rule: {
            id: "phase_elevated_still",
            text: `Heart rate above ${thresholds.heartRateStillAbovePerMin} /min while steps stayed under ${STILL_STEPS_PER_15_MIN} per 15 minutes and no walk or run was recorded.`,
          },
          events: group.flatMap((reading) => {
            const stepReading = stepsAt(ms(reading.at));
            return stepReading === undefined ? [] : [stepReading.id];
          }),
        },
      ] as const;
    }),
    ...runs.flatMap((run) => {
      const recovery = recoveryAfter(day, run, thresholds);
      const backAt = recovery.back_at === null ? null : ms(recovery.back_at);
      return [
        [
          "running",
          {
            from: ms(run.from),
            to: ms(run.to),
            inclusive: true,
            rule: { id: "phase_running", text: "A run the device recorded." },
            events: [run.id],
          },
        ],
        [
          "recovery",
          {
            from: ms(run.to) + 1,
            to: Math.min(backAt ?? ms(run.to) + 60 * MINUTE, ms(run.to) + 60 * MINUTE),
            inclusive: true,
            rule: {
              id: "phase_recovery",
              text: `From the end of a run until heart rate is back within ${thresholds.recoveryWithinPerMin} /min of the rate before it, or an hour.`,
            },
            events: [run.id],
          },
        ],
      ] as const;
    }),
    ...(() => {
      const from = windDown?.from ?? evening?.from;
      if (from === undefined) return [];
      return [
        [
          "winding_down",
          {
            from: ms(from),
            to: end,
            rule: {
              id: "phase_winding_down",
              text: "From the person's own winding-down tag, or recorded sleep, to the end of the day.",
            },
            events: [windDown?.id, evening?.id].filter(
              (one): one is string => one !== undefined,
            ),
          },
        ],
      ] as const;
    })(),
  ];

  // ─── glucose ──────────────────────────────────────────────────────────────

  const glucoseStatus = (
    phase: GlucosePhase,
    readings: readonly AvailableReading[],
  ): StatusResult => {
    const ids = readings.map((reading) => reading.id);
    const values = readings.map((reading) => reading.value);
    const highest = Math.max(...values);
    const lowest = Math.min(...values);
    const threshold = glucoseThresholdRule(profile, thresholds);
    const pastHigh = glucosePast(highest, profile, thresholds) === "above";
    const pastLow = glucosePast(lowest, profile, thresholds) === "below";
    if (pastHigh || pastLow) {
      return decide(day.origin, threshold, {
        status: "worth_a_look",
        evidence: ids,
        reason: pastHigh ? `Up to ${highest} mg/dL.` : `Down to ${lowest} mg/dL.`,
      });
    }
    const meal =
      phase === "breakfast" ||
      phase === "lunch" ||
      phase === "lunch_with_walking" ||
      phase === "snack" ||
      phase === "dinner";
    if (!meal) {
      return decide(day.origin, threshold, {
        status: "usual",
        evidence: ids,
        reason: `Between ${lowest} and ${highest} mg/dL.`,
      });
    }
    const first = readings[0];
    if (readings.length < 2 || first === undefined) {
      return decide(day.origin, GLUCOSE_MEAL_RISE, {
        status: "insufficient_data",
        evidence: ids,
        reason: "Fewer than two glucose readings after the meal, so no rise can be read.",
      });
    }
    const rise = highest - first.value;
    return decide(day.origin, GLUCOSE_MEAL_RISE, {
      status: rise >= MEAL_RISE_NOTABLE_MG_DL ? "notable" : "usual",
      evidence: ids,
      reason: `Rose ${rise} mg/dL, from ${first.value} to ${highest} mg/dL.`,
    });
  };

  const LOWEST_GLUCOSE: ReadonlySet<GlucosePhase> = new Set([
    "overnight_fasting",
    "running",
    "return_to_sleep",
  ]);

  const glucosePhase = (phase: GlucosePhase, window: Window): StoryPhase | null => {
    if (specimen === undefined) return null;
    const readings = glucose.filter(between(window.from, window.to, window.inclusive));
    if (readings.length === 0) return null;
    const from = iso(window.from);
    const to = iso(window.to);
    const id = `glucose-${phase}-${from}`;
    return {
      id,
      stream: "glucose",
      specimen,
      phase,
      label: GLUCOSE_LABELS[phase],
      from,
      to,
      provenance: "derived",
      rule: window.rule,
      evidence: [...window.events, ...readings.map((reading) => reading.id)],
      extreme: extremeOf(
        readings,
        LOWEST_GLUCOSE.has(phase) ? "lowest" : "highest",
        "mg/dL",
      ),
      status: glucoseStatus(phase, readings),
      narration: narrationFor(day, id, from, to, GLUCOSE_NARRATION[phase]),
    };
  };

  const nightWindows = (): readonly (readonly [GlucosePhase, Window])[] => {
    if (morning === undefined) return [];
    const from = Math.max(start, ms(morning.from));
    const to = ms(morning.to);
    if (meals.some((meal) => ms(meal.from) < to && ms(meal.to) > from)) return [];
    const inNight = glucose.filter(between(from, to, true));
    const low = extremeOf(inNight, "lowest", "mg/dL");
    const last = inNight.at(-1);
    const dawn =
      low !== null && last !== undefined && last.value - low.value >= DAWN_RISE_MG_DL;
    const lowAt = low === null ? to : ms(low.at);
    const fasting: Window = {
      from,
      to: dawn ? lowAt : to,
      rule: {
        id: "phase_overnight_fasting",
        text: "Recorded sleep before waking with no meal, up to the night's lowest glucose.",
      },
      events: [morning.id],
    };
    const dawnWindow: Window = {
      from: lowAt,
      to,
      inclusive: true,
      rule: {
        id: "phase_dawn",
        text: `From the night's lowest glucose to waking, a rise of ${DAWN_RISE_MG_DL} mg/dL or more with no meal.`,
      },
      events: [morning.id],
    };
    return [
      ...(fasting.to > fasting.from ? [["overnight_fasting", fasting] as const] : []),
      ...(dawn ? [["dawn", dawnWindow] as const] : []),
    ];
  };

  const mealWindows = (): readonly (readonly [GlucosePhase, Window])[] =>
    meals.flatMap((meal, index): readonly (readonly [GlucosePhase, Window])[] => {
      const next = meals[index + 1];
      const from = ms(meal.from);
      const to = Math.min(
        from + MEAL_WINDOW_MIN * MINUTE,
        next === undefined ? end : ms(next.from),
        end,
      );
      const name = meal.meal ?? "snack";
      const rule = {
        id: `phase_${name}`,
        text: `The ${MEAL_WINDOW_MIN} minutes after the person's own ${name} tag, or until the next meal.`,
      };
      if (name !== "lunch")
        return [[name, { from, to, rule, events: [meal.id] }] as const];
      const walk = walks.find(
        (one) => ms(one.from) >= from && ms(one.from) <= from + 60 * MINUTE,
      );
      return walk === undefined
        ? [["lunch", { from, to, rule, events: [meal.id] }] as const]
        : [
            [
              "lunch_with_walking",
              {
                from,
                to: Math.max(to, ms(walk.to)),
                rule: {
                  id: "phase_lunch_with_walking",
                  text: "The person's own lunch tag with a walk the device recorded starting within an hour of it.",
                },
                events: [meal.id, walk.id],
              },
            ] as const,
          ];
    });

  const glucoseWindows: readonly (readonly [GlucosePhase, Window])[] = [
    ...nightWindows(),
    ...mealWindows(),
    ...runs.map(
      (run) =>
        [
          "running",
          {
            from: ms(run.from),
            to: ms(run.to),
            inclusive: true,
            rule: { id: "phase_running", text: "A run the device recorded." },
            events: [run.id],
          },
        ] as const,
    ),
    ...(evening === undefined
      ? []
      : ([
          [
            "return_to_sleep",
            {
              from: ms(evening.from),
              to: end,
              rule: {
                id: "phase_return_to_sleep",
                text: "From recorded sleep in the evening to the end of the day.",
              },
              events: [evening.id],
            },
          ],
        ] as const)),
  ];

  return [
    ...heartWindows.map(([phase, window]) => heartPhase(phase, window)),
    ...glucoseWindows.map(([phase, window]) => glucosePhase(phase, window)),
  ]
    .filter((phase): phase is StoryPhase => phase !== null)
    .sort(
      (a, b) =>
        ms(a.from) - ms(b.from) ||
        (a.stream === b.stream ? 0 : a.stream === "heart_rate" ? -1 : 1),
    );
};

/** The status rules a phase list used, once each: for a "how is this decided" panel. */
export const rulesOf = (phases: readonly StoryPhase[]): readonly StatusRule[] => [
  ...new Map(phases.map((phase) => [phase.status.rule.id, phase.status.rule])).values(),
];
