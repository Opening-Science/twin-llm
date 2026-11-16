import { z } from "zod";

import { type DayBeat, type Direction } from "./day-beat";
import THRESHOLDS_JSON from "./day-thresholds.json";

/**
 * A day of heart rate and glucose turned into beats and red windows. Pure,
 * free of I/O, tested with the illustrative mock day in `fixtures/`.
 *
 * - One measured beat per reading, about the signal that moved most since the
 *   reading before, each change over its own scale: 20 /min of heart rate
 *   weighs as much as 15 mg/dL of glucose. A tie, or a first reading, goes to
 *   heart rate. A change under 5 /min or 10 mg/dL is "steady".
 * - A narrated insulin beat wherever glucose rose 20 mg/dL or more: insulin is
 *   described, never measured, so it carries no value.
 * - Red windows: consecutive readings past a threshold from
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
  glucoseMgDl: number | null;
  /** Null when activity is not recorded. */
  moving: boolean | null;
}>;

export const GLUCOSE_PROFILES = ["without_diabetes", "with_diabetes"] as const;
export type GlucoseProfile = (typeof GLUCOSE_PROFILES)[number];

export type RedWindow = Readonly<{
  from: string;
  to: string;
  measure: "heart_rate" | "glucose";
  /** The highest (or, below a range, lowest) value in the window. */
  extreme: number;
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

const INSULIN_BODY =
  "The pancreas releases insulin, which helps cells take up sugar. Insulin is not measured here; this beat describes what usually happens.";

const measuredBeat = (reading: DayReading, before: DayReading | null): DayBeat | null => {
  const event = reading.event ?? "Reading";
  const glucoseChange = change(reading.glucoseMgDl, before?.glucoseMgDl ?? null);
  const heartChange = change(reading.heartRatePerMin, before?.heartRatePerMin ?? null);
  const moved = (value: number | null, scale: number): number =>
    value === null ? 0 : Math.abs(value) / scale;
  const aboutGlucose =
    reading.glucoseMgDl !== null &&
    (reading.heartRatePerMin === null ||
      moved(glucoseChange, SCALE.glucose) > moved(heartChange, SCALE.heart_rate));
  if (aboutGlucose && reading.glucoseMgDl !== null) {
    const direction = directionOf("glucose", glucoseChange);
    const organ = direction === "down" ? "liver" : "bloodvasculature";
    return {
      time: reading.time,
      event,
      source: "measured",
      signal: {
        measure: "glucose",
        direction,
        value: reading.glucoseMgDl,
        unit: "mg/dL",
      },
      body: { text: GLUCOSE_BODY[direction], organ },
      view: { focus: organ, depth: "organs" },
    };
  }
  if (reading.heartRatePerMin === null) return null;
  const direction = directionOf("heart_rate", heartChange);
  return {
    time: reading.time,
    event,
    source: "measured",
    signal: {
      measure: "heart_rate",
      direction,
      value: reading.heartRatePerMin,
      unit: "/min",
    },
    body: { text: HEART_BODY[direction], organ: "heart" },
    view: { focus: "heart", depth: "organs" },
  };
};

const insulinBeat = (reading: DayReading, before: DayReading | null): DayBeat | null => {
  const rise = change(reading.glucoseMgDl, before?.glucoseMgDl ?? null);
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
  reading: DayReading,
  profile: GlucoseProfile,
  thresholds: DayThresholds,
): boolean => {
  const value = reading.glucoseMgDl;
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

const glucoseRule = (profile: GlucoseProfile, thresholds: DayThresholds): string => {
  if (profile === "without_diabetes") {
    return `Blood glucose above ${thresholds.glucoseWithoutDiabetesAboveMgDl} mg/dL (placeholder, without diabetes)`;
  }
  const [low, high] = thresholds.glucoseWithDiabetesRangeMgDl;
  return `Blood glucose outside ${low}–${high} mg/dL (placeholder consensus range, with diabetes)`;
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
    sorted,
    (reading) => heartBreach(reading, thresholds),
    (reading) => reading.heartRatePerMin ?? 0,
  ).map((run): RedWindow => ({
    from: run[0]?.time ?? "",
    to: run[run.length - 1]?.time ?? "",
    measure: "heart_rate",
    extreme: extremeOf(run, false),
    rule: `Heart rate above ${thresholds.heartRateStillAbovePerMin} /min while still (placeholder)`,
    thresholds: "placeholder",
  }));
  const low =
    profile === "with_diabetes" ? thresholds.glucoseWithDiabetesRangeMgDl[0] : -Infinity;
  const glucose = runsOf(
    sorted,
    (reading) => glucoseBreach(reading, profile, thresholds),
    (reading) => reading.glucoseMgDl ?? 0,
  ).map((run): RedWindow => ({
    from: run[0]?.time ?? "",
    to: run[run.length - 1]?.time ?? "",
    measure: "glucose",
    extreme: extremeOf(run, (run[0]?.value ?? 0) < low),
    rule: glucoseRule(profile, thresholds),
    thresholds: "placeholder",
  }));
  return [...heart, ...glucose].sort((a, b) => a.from.localeCompare(b.from));
};

const windowBeat = (window: RedWindow): DayBeat => {
  if (window.measure === "heart_rate") {
    return {
      time: window.from,
      event: "Red window",
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
  return {
    time: window.from,
    event: "Red window",
    source: "derived",
    signal: { measure: "glucose", direction: "up", value: window.extreme, unit: "mg/dL" },
    body: {
      text: `Blood sugar stays past the threshold for a while. ${window.rule}.`,
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
  return sorted.flatMap((reading, index) => {
    const before = sorted[index - 1] ?? null;
    return [
      measuredBeat(reading, before),
      insulinBeat(reading, before),
      ...windows.filter((window) => window.from === reading.time).map(windowBeat),
    ].filter((beat): beat is DayBeat => beat !== null);
  });
};
