import { formatDate, formatNumber } from "@/infrastructure/format-measure";

import {
  type DayPlan,
  type MotionDay,
  type MovingClip,
  playbackRate,
  REFERENCE_CADENCE,
} from "./day-motion";
import { type MotionClip } from "./gait";

/**
 * Copy for whole-body motion, in one place so `lint:claims` sees it. The clips
 * are generic and computed; the copy never suggests they are this person's gait
 * or breathing.
 */
export const MOTION_LABEL: Readonly<Record<MotionClip, string>> = {
  walk: "Walk",
  run: "Run",
  idle: "Idle",
  dance: "Dance loop",
  video: "Dance (video)",
  cycle: "Cycle",
  sleep: "Sleep",
};

export const MOTION_LINE: Readonly<Record<MotionClip, string>> = {
  walk: "A generic walk cycle, computed from typical joint angles, not this person's gait. Walking in place.",
  run: "A generic easy run, computed from typical joint angles, not this person's running. Running in place.",
  idle: "A generic standing breath and sway, not this person's breathing.",
  dance: "A computed dance loop, not motion capture and not this person's movement.",
  video:
    "A dance traced from a video by pose estimation on this machine, approximate and not this person's movement. Dancing in place.",
  cycle:
    "A generic pedalling motion, computed from a crank circle and a typical leg, not this person's pedalling. No bike is drawn.",
  sleep: "A computed resting pose lying on the back, not this person's sleep posture.",
};

export const MOTION_CLIP_NOT_INSTALLED_API =
  "Motion clip not installed. Make one with python/motion/video_to_clip.py.";
export const MOTION_CLIP_UNREADABLE_API =
  "The motion clip on this machine could not be read. Make it again with python/motion/video_to_clip.py.";

export const TEMPO_LABEL = "Tempo";
export const tempoOption = (bpm: number): string => `${formatNumber(bpm, 0)} BPM`;

export const MOTION_HIDES_ANATOMY =
  "Anatomy layers are hidden while the body moves: they cannot follow its joints.";

export const MOTION_REDUCED = "Motion is off because the system asks for reduced motion.";
/**
 * The demo body loads without a skeleton only when the rigged copy was never
 * installed on this machine, so the reason names the command that downloads it.
 */
export const MOTION_NO_RIG_DEMO =
  "The demo body that can walk is not installed on this machine. Run bun run anatomy:fetch.";
export const MOTION_NO_RIG_SCAN = "This scan has no skeleton the walk can drive.";

/**
 * The lines beside the 3D view about motion: what plays and that it is
 * generic (or, while the twin follows a wearable day, that day's lines), that
 * the anatomy layers are hidden meanwhile, or why nothing can play on this body.
 */
export const motionLines = (
  control:
    | Readonly<{
        clip: MotionClip | null;
        unavailable: string | null;
        dayLines?: readonly string[] | null;
      }>
    | undefined,
  anatomyShown: boolean,
): readonly string[] => {
  if (!control) return [];
  if (control.unavailable !== null) return [control.unavailable];
  if (control.clip === null) return [];
  const lines = control.dayLines ?? [MOTION_LINE[control.clip]];
  return anatomyShown ? [...lines, MOTION_HIDES_ANATOMY] : lines;
};

export const MOTION_DAYS_SIGN_IN = "Sign in to see synthetic wearable days.";
export const MOTION_DAYS_NOT_FOUND = "No synthetic wearable days for this person.";
export const MOTION_DAYS_FAILED = "Could not load synthetic wearable days.";

/** The wearable day the twin follows (#52). */
export const DAY_PANEL = "Wearable day";
export const DAY_FOLLOW = "Follow day";
export const DAY_SELECT = "Day";
export const DAY_NIGHT = "Night";
export const DAY_VISUAL_CUE = "Visual cue, not a physiological simulation.";
export const DAY_ABOUT =
  "The day's workout picks the motion and its cadence the speed; Night lies the body down breathing at that night's respiratory rate. A visual cue, not a physiological simulation.";
export const DAY_LOADING = "Loading wearable days…";
export const DAY_FAILED = "Could not load wearable days.";
export const DAY_NONE_DEMO =
  "This synthetic person has no synthetic wearable series in the warehouse.";
export const DAY_NONE_SELF =
  "No workouts or breathing rates in the linked wearables' recent data.";
export const DAY_NONE_OTHER = "Only the Demo and Self have wearable days.";

const sportLabel = (sport: string): string => {
  const words = sport.replace(/[_-]+/g, " ").trim();
  return words.length === 0 ? "Workout" : words[0]!.toUpperCase() + words.slice(1);
};

const minutesText = (minutes: number | null): string =>
  minutes === null ? "" : `, ${formatNumber(minutes, 0)} min`;

/** One option in the day select: "29 Oct 2026 · Running, 42 min" or "· no workout". */
export const dayOption = (day: MotionDay): string =>
  `${formatDate(day.day)} · ${
    day.workout
      ? `${sportLabel(day.workout.sport)}${minutesText(day.workout.minutes)}`
      : "no workout"
  }`;

const CLIP_VERB: Readonly<Record<MovingClip, string>> = {
  run: "Running",
  walk: "Walking",
  cycle: "Pedalling",
};
const CADENCE_UNIT: Readonly<Record<MovingClip, string>> = {
  run: "steps",
  walk: "steps",
  cycle: "turns",
};
const CLIP_NAME: Readonly<Record<MovingClip, string>> = {
  run: "run",
  walk: "walk",
  cycle: "pedalling",
};

const basisText = (clip: MovingClip, plan: DayPlan): string => {
  const speed = plan.speedKmh === null ? "" : `${formatNumber(plan.speedKmh, 1)} km/h`;
  switch (plan.basis) {
    case "recorded":
      return "the recorded cadence";
    case "pace":
      return `estimated from the recorded pace, ${speed}`;
    case "assumed":
      return clip === "cycle"
        ? "synthetic workouts record no cadence, so one is assumed from the workout's length"
        : `synthetic workouts record no cadence or pace, so ${speed} is assumed from the workout's length`;
    default:
      return "no cadence or pace recorded, so the generic rate";
  }
};

/**
 * The lines beside the view while the twin follows a day: always the visual
 * cue line first, then what plays, at which rate and how the rate was found,
 * or why the body stands or lies still. `source` names whose data it is.
 */
export const dayLines = (
  plan: DayPlan,
  day: MotionDay,
  source: string,
): readonly string[] => {
  const date = formatDate(day.day);
  if (plan.clip === "sleep") {
    const breathing =
      plan.breathsPerMinute === null
        ? "No respiratory rate is recorded for this night, so it lies still."
        : `Breathing ${formatNumber(plan.breathsPerMinute, 1)} times a minute, the night's respiratory rate (${source}).`;
    return [
      DAY_VISUAL_CUE,
      `Night ending on ${date}: lying on the back. ${breathing}`,
      "There is no lying clip: the body is turned at the hips to lie on its back in a resting pose.",
    ];
  }
  const workout = day.workout;
  if (plan.clip === "idle" || !workout) {
    return [
      DAY_VISUAL_CUE,
      workout
        ? `${date}: ${sportLabel(workout.sport)}${minutesText(workout.minutes)} (${source}). There is no clip for it, so the body stands at rest.`
        : `${date}: no workout recorded, so the body stands at rest.`,
    ];
  }
  const clip = plan.clip;
  const cadence = plan.cadence ?? REFERENCE_CADENCE[clip];
  return [
    DAY_VISUAL_CUE,
    `${date}: ${workout ? sportLabel(workout.sport) : CLIP_VERB[clip]}${minutesText(workout?.minutes ?? null)} (${source}). ${CLIP_VERB[clip]} in place at ${formatNumber(cadence, 0)} ${CADENCE_UNIT[clip]} a minute, ${formatNumber(playbackRate(clip, cadence), 2)}× the generic ${CLIP_NAME[clip]}: ${basisText(clip, plan)}.`,
    ...(clip === "cycle" ? ["No bike is drawn."] : []),
  ];
};
