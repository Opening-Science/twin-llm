import { DEFAULT_CYCLE } from "./cycle-pose";
import { DEFAULT_RUN, DEFAULT_WALK } from "./gait";

/**
 * What a wearable day makes the twin do, as pure functions, so every mapping
 * is stated and tested. A visual cue, not a physiological simulation:
 *
 * - The day's workout picks the clip by its sport (run, walk, cycle); any
 *   other sport (strength, swimming, ...) and a day without one stand at rest
 *   (idle), since there is no clip for them.
 * - Its cadence sets the clip's rate: steps a minute for walk and run, crank
 *   turns a minute for the cycle. Recorded cadence is used when the data has
 *   it. Today's exports carry none, so a recorded distance and duration give
 *   the pace, and the pace a cadence by `cadenceFromSpeed`. Synthetic workouts
 *   have only minutes, so their pace is assumed from the length
 *   (`assumedSpeed`). Without any of these the clip keeps its generic rate.
 * - At night the twin lies on its back and breathes at that night's
 *   respiratory rate; without one it lies still.
 */

export type DayClip = "walk" | "run" | "cycle" | "idle" | "sleep";
export type MovingClip = "walk" | "run" | "cycle";

export type DayWorkout = Readonly<{
  /** The sport as the source names it: "running", "Cycling", "functional_fitness". */
  sport: string;
  minutes: number | null;
  /** Recorded distance in metres, when the export has it. */
  distanceM: number | null;
  /** Recorded steps (or crank turns) a minute, when the export has it. */
  cadence: number | null;
}>;

export type MotionDay = Readonly<{
  /** ISO day. */
  day: string;
  /** The day's longest workout, or null. */
  workout: DayWorkout | null;
  /** The respiratory rate of the night that ended on this day's morning. */
  breathsPerMinute: number | null;
}>;

/** How the cadence was found. */
export type CadenceBasis = "recorded" | "pace" | "assumed" | "generic";

export type DayPlan = Readonly<{
  clip: DayClip;
  /** Steps or crank turns a minute for a moving clip, else null. */
  cadence: number | null;
  basis: CadenceBasis | null;
  /** The pace behind the cadence, km/h, when there is one. */
  speedKmh: number | null;
  /** Breaths a minute while asleep; null lies still. */
  breathsPerMinute: number | null;
}>;

const SPORT_CLIPS: ReadonlyArray<Readonly<{ clip: MovingClip; pattern: RegExp }>> = [
  { clip: "run", pattern: /run|jog|treadmill/ },
  { clip: "cycle", pattern: /cycl|bik|spin/ },
  { clip: "walk", pattern: /walk|hik/ },
];

/** The clip for a workout's sport; anything without a clip stands at rest. */
export const workoutClip = (sport: string): MovingClip | "idle" =>
  SPORT_CLIPS.find((rule) => rule.pattern.test(sport.toLowerCase()))?.clip ?? "idle";

/** The rate each clip is drawn at; a day's cadence over it is the playback rate. */
export const REFERENCE_CADENCE: Readonly<Record<MovingClip, number>> = {
  walk: DEFAULT_WALK.cadence,
  run: DEFAULT_RUN.cadence,
  cycle: DEFAULT_CYCLE.rpm,
};

/** Cadences outside these are a data error and are not used. */
export const PLAUSIBLE_CADENCE: Readonly<Record<MovingClip, readonly [number, number]>> =
  {
    walk: [60, 150],
    run: [120, 220],
    cycle: [30, 140],
  };

/** Clamp ranges for a cadence estimated from pace. */
const PACE_CADENCE: Readonly<Record<"walk" | "run", readonly [number, number]>> = {
  walk: [80, 135],
  run: [150, 195],
};

const clamp = (value: number, [lo, hi]: readonly [number, number]): number =>
  Math.min(hi, Math.max(lo, value));

const round1 = (value: number): number => Math.round(value * 10) / 10;

/**
 * Steps a minute from speed in km/h, a rough straight-line fit to typical
 * adult values, not a person's own: running 135 + 3 × km/h (165 at 10 km/h,
 * 180 at 15 km/h), clamped to 150–195; walking 47 + 13 × km/h (112 at 5
 * km/h), clamped to 80–135. Cycling cadence does not follow speed (gears), so
 * it has no rule.
 */
export const cadenceFromSpeed = (clip: "walk" | "run", kmh: number): number =>
  Math.round(clamp(clip === "run" ? 135 + 3 * kmh : 47 + 13 * kmh, PACE_CADENCE[clip]));

/** Recorded pace in km/h from metres and minutes, or null when either is missing or zero. */
export const recordedSpeed = (
  distanceM: number | null,
  minutes: number | null,
): number | null =>
  distanceM !== null && minutes !== null && distanceM > 0 && minutes > 0
    ? round1(distanceM / 1000 / (minutes / 60))
    : null;

/**
 * The stated assumption for synthetic workouts, which record only minutes: a
 * shorter session is taken as a faster one. Running goes from 12 km/h at 20
 * minutes to 9 km/h at 90 minutes, walking from 5.5 to 4.5 km/h, and pedalling
 * from 90 to 80 turns a minute, straight lines clamped at both ends.
 */
export const assumedRate = (clip: MovingClip, minutes: number): number => {
  const share = clamp((minutes - 20) / 70, [0, 1]);
  const [short, long] =
    clip === "run" ? [12, 9] : clip === "walk" ? [5.5, 4.5] : [90, 80];
  return round1(short + (long - short) * share);
};

const plausibleCadence = (clip: MovingClip, cadence: number | null): boolean =>
  cadence !== null &&
  Number.isFinite(cadence) &&
  cadence >= PLAUSIBLE_CADENCE[clip][0] &&
  cadence <= PLAUSIBLE_CADENCE[clip][1];

/**
 * A moving clip's cadence for a workout and how it was found. `synthetic`
 * allows the assumption; a person's own data never gets an assumed pace.
 */
export const workoutCadence = (
  clip: MovingClip,
  workout: DayWorkout,
  synthetic: boolean,
): Readonly<{ cadence: number; basis: CadenceBasis; speedKmh: number | null }> => {
  if (plausibleCadence(clip, workout.cadence)) {
    return {
      cadence: Math.round(workout.cadence as number),
      basis: "recorded",
      speedKmh: null,
    };
  }
  const speed = recordedSpeed(workout.distanceM, workout.minutes);
  if (speed !== null && clip !== "cycle") {
    return { cadence: cadenceFromSpeed(clip, speed), basis: "pace", speedKmh: speed };
  }
  if (synthetic && workout.minutes !== null && workout.minutes > 0) {
    const rate = assumedRate(clip, workout.minutes);
    return clip === "cycle"
      ? { cadence: Math.round(rate), basis: "assumed", speedKmh: null }
      : { cadence: cadenceFromSpeed(clip, rate), basis: "assumed", speedKmh: rate };
  }
  return { cadence: REFERENCE_CADENCE[clip], basis: "generic", speedKmh: null };
};

/** How much faster than drawn the clip plays: the day's cadence over the reference. */
export const playbackRate = (clip: MovingClip, cadence: number): number =>
  Math.round((cadence / REFERENCE_CADENCE[clip]) * 100) / 100;

/** Breathing outside this range is a data error, as for the live twin. */
export const PLAUSIBLE_BREATH: readonly [number, number] = [3, 60];

/** Seconds per breath at a rate, or null when there is no plausible rate. */
export const breathPeriod = (breathsPerMinute: number | null): number | null =>
  breathsPerMinute !== null &&
  Number.isFinite(breathsPerMinute) &&
  breathsPerMinute >= PLAUSIBLE_BREATH[0] &&
  breathsPerMinute <= PLAUSIBLE_BREATH[1]
    ? Math.round((60 / breathsPerMinute) * 1000) / 1000
    : null;

/** What the twin does on `day`, by day or (with `night`) asleep. */
export const dayPlan = (day: MotionDay, night: boolean, synthetic: boolean): DayPlan => {
  if (night) {
    const period = breathPeriod(day.breathsPerMinute);
    return {
      clip: "sleep",
      cadence: null,
      basis: null,
      speedKmh: null,
      breathsPerMinute: period === null ? null : day.breathsPerMinute,
    };
  }
  const clip = day.workout ? workoutClip(day.workout.sport) : "idle";
  if (clip === "idle" || !day.workout) {
    return {
      clip: "idle",
      cadence: null,
      basis: null,
      speedKmh: null,
      breathsPerMinute: null,
    };
  }
  const { cadence, basis, speedKmh } = workoutCadence(clip, day.workout, synthetic);
  return { clip, cadence, basis, speedKmh, breathsPerMinute: null };
};
