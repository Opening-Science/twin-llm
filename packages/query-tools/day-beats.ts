import { z } from "zod";

import { type DayBeat, type Direction, type GlucoseSpecimen } from "./day-beat";
import THRESHOLDS_JSON from "./day-thresholds.json";

/**
 * A day of heart rate and glucose turned into beats and red windows. Pure,
 * free of I/O, tested with the illustrative mock day in `fixtures/`.
 *
 * - One measured beat per reading, about the signal that moved most since its
 *   own last reading, each change over its own scale: 20 /min of heart rate
 *   weighs as much as 15 mg/dL of glucose. A tie, or a first reading, goes to
 *   heart rate, then blood glucose. A change under 5 /min or 10 mg/dL is "steady".
 * - Sensor glucose (a continuous monitor) is its own signal: its change is
 *   taken against the sensor reading before, never against blood, and its
 *   windows are its own. It trails blood glucose by several minutes, and its
 *   sentences say so.
 * - A narrated insulin beat wherever glucose rose 20 mg/dL or more (blood, or
 *   the sensor when the reading has no blood value): insulin is described,
 *   never measured, so it carries no value.
 * - Red windows: consecutive readings of one measure past a threshold from
 *   `day-thresholds.json` (placeholders for Robin to confirm). Heart rate
 *   counts only while still; a reading with unknown activity is not judged.
 *   Each window opens with a derived beat at its highest value.
 */

export type DayReading = Readonly<{
  /** "HH:MM". */
  time: string;
  /** What the person was doing; null when nothing is recorded. */
  event: string | null;
  heartRatePerMin: number | null;
  /** Glucose in blood. */
  glucoseMgDl: number | null;
  /** Glucose from a continuous sensor; absent or null when there is none. */
  sensorGlucoseMgDl?: number | null;
  /** Null when activity is not recorded. */
  moving: boolean | null;
}>;

export const GLUCOSE_PROFILES = ["without_diabetes", "with_diabetes"] as const;
export type GlucoseProfile = (typeof GLUCOSE_PROFILES)[number];

export type RedWindow = Readonly<{
  from: string;
  to: string;
  measure: "heart_rate" | "glucose";
  /** Blood or sensor for a glucose window; null for heart rate. */
  specimen: GlucoseSpecimen | null;
  /** The highest (or, below a range, lowest) value in the window. */
  extreme: number;
  /** Which side of the threshold the window is on; only glucose with diabetes can be below. */
  side: "above" | "below";
  rule: string;
  /** The thresholds are placeholders until reviewed. */
  thresholds: "placeholder";
}>;

const thresholdsSchema = z
  .object({
    status: z.literal("placeholder"),
    reviewer: z.string().min(1),
    note: z.string().min(1),
    heartRateStillAbovePerMin: z.number().positive(),
    glucoseWithoutDiabetesAboveMgDl: z.number().positive(),
    glucoseWithDiabetesRangeMgDl: z.tuple([z.number().positive(), z.number().positive()]),
    recoveryWithinPerMin: z.number().positive(),
  })
  .strict();

export type DayThresholds = z.infer<typeof thresholdsSchema>;

export const DAY_THRESHOLDS: DayThresholds = thresholdsSchema.parse(THRESHOLDS_JSON);

/**
 * Rules in code, not yet in the JSON: how much change counts as one unit of
 * "moved" per signal, the change under which a signal is steady, and the
 * glucose rise that adds a narrated insulin beat. Exported for the review page.
 */
export const DAY_RULES = {
  scale: { heart_rate: 20, glucose: 15 },
  steady: { heart_rate: 5, glucose: 10 },
  insulinRise: 20,
} as const;

const SCALE = DAY_RULES.scale;
const INSULIN_RISE = DAY_RULES.insulinRise;
const STEADY = DAY_RULES.steady;

const directionOf = (
  measure: "heart_rate" | "glucose",
  change: number | null,
): Direction => {
  if (change === null || Math.abs(change) < STEADY[measure]) return "steady";
  return change > 0 ? "up" : "down";
};

const change = (now: number | null, before: number | null): number | null =>
  now === null || before === null ? null : now - before;

const HEART_BODY: Readonly<Record<Direction, string>> = {
  up: "The heart beats faster to move more blood to working muscles.",
  down: "The heart slows as the body settles.",
  steady: "The heart keeps a steady pace.",
};

const GLUCOSE_BODY: Readonly<Record<Direction, string>> = {
  up: "Sugar from food passes into the blood.",
  down: "Muscle and liver take sugar out of the blood.",
  steady: "Blood sugar holds near its usual level.",
};

const SENSOR_LAG =
  "The sensor reads the fluid between cells, several minutes behind the blood.";

const SENSOR_BODY: Readonly<Record<Direction, string>> = {
  up: `Sugar from food passes into the blood and on into the fluid between cells. ${SENSOR_LAG}`,
  down: `Muscle and liver take sugar out of the blood, and the fluid between cells follows. ${SENSOR_LAG}`,
  steady: `Sensor glucose holds near its usual level. ${SENSOR_LAG}`,
};

const sensorOf = (reading: DayReading | null): number | null =>
  reading?.sensorGlucoseMgDl ?? null;

/** Each measure's last value before a reading; null when it has none yet that day. */
type Previous = Readonly<{
  heartRate: number | null;
  glucose: number | null;
  sensor: number | null;
}>;

const NOTHING_BEFORE: Previous = { heartRate: null, glucose: null, sensor: null };

/**
 * For each reading, each measure's last value before it. Readings are paired
 * by minute and the measures come at their own pace (heart rate often every
 * minute, glucose every few), so the reading just before may hold only
 * another measure. Each change is taken against the measure's own last value.
 */
const previousValues = (sorted: readonly DayReading[]): readonly Previous[] =>
  sorted.reduce<{ last: Previous; out: readonly Previous[] }>(
    (acc, reading) => ({
      last: {
        heartRate: reading.heartRatePerMin ?? acc.last.heartRate,
        glucose: reading.glucoseMgDl ?? acc.last.glucose,
        sensor: sensorOf(reading) ?? acc.last.sensor,
      },
      out: [...acc.out, acc.last],
    }),
    { last: NOTHING_BEFORE, out: [] },
  ).out;

const INSULIN_BODY =
  "The pancreas releases insulin, which helps cells take up sugar. Insulin is not measured here; this beat describes what usually happens.";

type Candidate = Readonly<{
  measure: "heart_rate" | "glucose";
  specimen: GlucoseSpecimen | null;
  value: number;
  change: number | null;
}>;

/** The signals a reading holds, in tie order: heart rate, blood glucose, sensor glucose. */
const candidatesOf = (reading: DayReading, before: Previous): readonly Candidate[] => {
  const all: readonly (Omit<Candidate, "value"> & { value: number | null })[] = [
    {
      measure: "heart_rate",
      specimen: null,
      value: reading.heartRatePerMin,
      change: change(reading.heartRatePerMin, before.heartRate),
    },
    {
      measure: "glucose",
      specimen: "blood",
      value: reading.glucoseMgDl,
      change: change(reading.glucoseMgDl, before.glucose),
    },
    {
      measure: "glucose",
      specimen: "sensor",
      value: sensorOf(reading),
      change: change(sensorOf(reading), before.sensor),
    },
  ];
  return all.filter((one): one is Candidate => one.value !== null);
};

const moved = (candidate: Candidate): number =>
  candidate.change === null
    ? 0
    : Math.abs(candidate.change) /
      (candidate.measure === "heart_rate" ? SCALE.heart_rate : SCALE.glucose);

const measuredBeat = (reading: DayReading, before: Previous): DayBeat | null => {
  const event = reading.event ?? "Reading";
  const chosen = candidatesOf(reading, before).reduce<Candidate | null>(
    (best, candidate) =>
      best === null || moved(candidate) > moved(best) ? candidate : best,
    null,
  );
  if (chosen === null) return null;
  const direction = directionOf(chosen.measure, chosen.change);
  if (chosen.measure === "heart_rate") {
    return {
      time: reading.time,
      event,
      source: "measured",
      signal: { measure: "heart_rate", direction, value: chosen.value, unit: "/min" },
      body: { text: HEART_BODY[direction], organ: "heart" },
      view: { focus: "heart", depth: "organs" },
    };
  }
  const specimen = chosen.specimen ?? "blood";
  const organ = direction === "down" ? "liver" : "bloodvasculature";
  return {
    time: reading.time,
    event,
    source: "measured",
    signal: {
      measure: "glucose",
      specimen,
      direction,
      value: chosen.value,
      unit: "mg/dL",
    },
    body: {
      text: (specimen === "sensor" ? SENSOR_BODY : GLUCOSE_BODY)[direction],
      organ,
    },
    view: { focus: organ, depth: "organs" },
  };
};

const insulinBeat = (reading: DayReading, before: Previous): DayBeat | null => {
  const rise =
    reading.glucoseMgDl !== null
      ? change(reading.glucoseMgDl, before.glucose)
      : change(sensorOf(reading), before.sensor);
  if (rise === null || rise < INSULIN_RISE) return null;
  return {
    time: reading.time,
    event: reading.event ?? "Reading",
    source: "narrated",
    signal: { measure: "insulin", direction: "up", value: null, unit: null },
    body: { text: INSULIN_BODY, organ: "pancreas" },
    view: { focus: "pancreas", depth: "organs" },
  };
};

type Breach = Readonly<{ time: string; value: number }>;

const glucoseBreach = (
  value: number | null,
  profile: GlucoseProfile,
  thresholds: DayThresholds,
): boolean => {
  if (value === null) return false;
  if (profile === "without_diabetes")
    return value > thresholds.glucoseWithoutDiabetesAboveMgDl;
  const [low, high] = thresholds.glucoseWithDiabetesRangeMgDl;
  return value < low || value > high;
};

const heartBreach = (reading: DayReading, thresholds: DayThresholds): boolean =>
  reading.moving === false &&
  reading.heartRatePerMin !== null &&
  reading.heartRatePerMin > thresholds.heartRateStillAbovePerMin;

/** Runs of consecutive breaching readings. */
const runsOf = (
  readings: readonly DayReading[],
  breaches: (reading: DayReading) => boolean,
  valueOf: (reading: DayReading) => number,
): readonly (readonly Breach[])[] =>
  readings.reduce<Breach[][]>((runs, reading, index) => {
    if (!breaches(reading)) return runs;
    const breach = { time: reading.time, value: valueOf(reading) };
    const previous = readings[index - 1];
    const last = runs[runs.length - 1];
    return previous !== undefined && breaches(previous) && last !== undefined
      ? [...runs.slice(0, -1), [...last, breach]]
      : [...runs, [breach]];
  }, []);

const glucoseRule = (
  profile: GlucoseProfile,
  thresholds: DayThresholds,
  specimen: GlucoseSpecimen,
): string => {
  const name = specimen === "sensor" ? "Sensor glucose" : "Blood glucose";
  if (profile === "without_diabetes") {
    return `${name} above ${thresholds.glucoseWithoutDiabetesAboveMgDl} mg/dL (placeholder, without diabetes)`;
  }
  const [low, high] = thresholds.glucoseWithDiabetesRangeMgDl;
  return `${name} outside ${low}–${high} mg/dL (placeholder consensus range, with diabetes)`;
};

/**
 * Glucose windows of one specimen, run over the readings that carry that
 * specimen's value, so a reading holding only another measure does not split
 * a window.
 */
const glucoseWindows = (
  sorted: readonly DayReading[],
  profile: GlucoseProfile,
  thresholds: DayThresholds,
  specimen: GlucoseSpecimen,
): readonly RedWindow[] => {
  const valueOf = (reading: DayReading): number | null =>
    specimen === "sensor" ? sensorOf(reading) : reading.glucoseMgDl;
  const readings = sorted.filter((reading) => valueOf(reading) !== null);
  const low =
    profile === "with_diabetes" ? thresholds.glucoseWithDiabetesRangeMgDl[0] : -Infinity;
  // One pass per side, so a run that jumps from below the range to above it
  // is two windows, each with its own extreme.
  return (["below", "above"] as const).flatMap((side) =>
    runsOf(
      readings,
      (reading) =>
        glucoseBreach(valueOf(reading), profile, thresholds) &&
        (valueOf(reading) ?? 0) < low === (side === "below"),
      (reading) => valueOf(reading) ?? 0,
    ).map((run): RedWindow => ({
      from: run[0]?.time ?? "",
      to: run[run.length - 1]?.time ?? "",
      measure: "glucose",
      specimen,
      extreme: extremeOf(run, side === "below"),
      side,
      rule: glucoseRule(profile, thresholds, specimen),
      thresholds: "placeholder",
    })),
  );
};

const extremeOf = (run: readonly Breach[], below: boolean): number =>
  below
    ? Math.min(...run.map((breach) => breach.value))
    : Math.max(...run.map((breach) => breach.value));

/** Red windows for the day, in time order. */
export const redWindows = (
  readings: readonly DayReading[],
  profile: GlucoseProfile,
  thresholds: DayThresholds = DAY_THRESHOLDS,
): readonly RedWindow[] => {
  const sorted = [...readings].sort((a, b) => a.time.localeCompare(b.time));
  const heart = runsOf(
    sorted.filter((reading) => reading.heartRatePerMin !== null),
    (reading) => heartBreach(reading, thresholds),
    (reading) => reading.heartRatePerMin ?? 0,
  ).map((run): RedWindow => ({
    from: run[0]?.time ?? "",
    to: run[run.length - 1]?.time ?? "",
    measure: "heart_rate",
    specimen: null,
    extreme: extremeOf(run, false),
    side: "above",
    rule: `Heart rate above ${thresholds.heartRateStillAbovePerMin} /min while still (placeholder)`,
    thresholds: "placeholder",
  }));
  const glucose = (["blood", "sensor"] as const).flatMap((specimen) =>
    glucoseWindows(sorted, profile, thresholds, specimen),
  );
  return [...heart, ...glucose].sort((a, b) => a.from.localeCompare(b.from));
};

/**
 * The event a red window's beat shows: a moment worth a look, never a judgement
 * about the person. "Red window" stays the name in code only.
 */
export const WINDOW_EVENT = "Worth a look";

const windowBeat = (window: RedWindow): DayBeat => {
  if (window.measure === "heart_rate") {
    return {
      time: window.from,
      event: WINDOW_EVENT,
      source: "derived",
      signal: {
        measure: "heart_rate",
        direction: "up",
        value: window.extreme,
        unit: "/min",
      },
      body: {
        text: `The heart beats fast while the body is still. ${window.rule}.`,
        organ: "heart",
      },
      view: { focus: "heart", depth: "organs" },
    };
  }
  const specimen = window.specimen ?? "blood";
  const name = specimen === "sensor" ? "Sensor glucose" : "Blood sugar";
  return {
    time: window.from,
    event: WINDOW_EVENT,
    source: "derived",
    signal: {
      measure: "glucose",
      specimen,
      direction: window.side === "below" ? "down" : "up",
      value: window.extreme,
      unit: "mg/dL",
    },
    body: {
      text:
        window.side === "below"
          ? `${name} stays below the range for a while. ${window.rule}.`
          : `${name} stays past the threshold for a while. ${window.rule}.`,
      organ: "bloodvasculature",
    },
    view: { focus: "bloodvasculature", depth: "organs" },
  };
};

/** The day's beats in time order: each reading, its insulin, then any red window it opens. */
export const dayBeats = (
  readings: readonly DayReading[],
  profile: GlucoseProfile,
  thresholds: DayThresholds = DAY_THRESHOLDS,
): readonly DayBeat[] => {
  const sorted = [...readings].sort((a, b) => a.time.localeCompare(b.time));
  const windows = redWindows(sorted, profile, thresholds);
  const previous = previousValues(sorted);
  return sorted.flatMap((reading, index) => {
    const before = previous[index] ?? NOTHING_BEFORE;
    return [
      measuredBeat(reading, before),
      insulinBeat(reading, before),
      ...windows.filter((window) => window.from === reading.time).map(windowBeat),
    ].filter((beat): beat is DayBeat => beat !== null);
  });
};
