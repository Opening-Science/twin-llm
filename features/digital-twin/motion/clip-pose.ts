import { cyclePose, DEFAULT_CYCLE } from "./cycle-pose";
import { dancePose, DEFAULT_TEMPO } from "./dance";
import {
  type BodyPose,
  DEFAULT_RUN,
  DEFAULT_WALK,
  idlePose,
  type MotionClip,
  runPose,
  walkPose,
  weighPose,
} from "./gait";
import { type KeyframeClip, keyframePose } from "./keyframe-clip";
import { sleepPose } from "./sleep-pose";

/**
 * The rates a wearable day sets (`day-motion.ts`): steps or crank turns a
 * minute for walk, run and cycle, and breaths a minute for sleep. Null keeps
 * the clip's own generic rate (for sleep: no breathing).
 */
export type ClipRates = Readonly<{
  cadence: number | null;
  breathsPerMinute: number | null;
}>;

export const GENERIC_RATES: ClipRates = { cadence: null, breathsPerMinute: null };

/**
 * The pose of a clip at `t` seconds; `tempo` (beats a minute) drives only the
 * dance loop, `video` is the installed keyframe clip the "video" clip plays
 * (without one it stands at rest, though the toolbar never offers it), and
 * `rates` come from a wearable day.
 */
export const clipPose = (
  clip: MotionClip,
  t: number,
  tempo: number = DEFAULT_TEMPO,
  video: KeyframeClip | null = null,
  rates: ClipRates = GENERIC_RATES,
): BodyPose => {
  switch (clip) {
    case "walk":
      return walkPose(t, {
        ...DEFAULT_WALK,
        cadence: rates.cadence ?? DEFAULT_WALK.cadence,
      });
    case "run":
      return runPose(t, { cadence: rates.cadence ?? DEFAULT_RUN.cadence });
    case "cycle":
      return cyclePose(t, { rpm: rates.cadence ?? DEFAULT_CYCLE.rpm });
    case "sleep":
      return sleepPose(t, { breathsPerMinute: rates.breathsPerMinute });
    case "idle":
      return idlePose(t);
    case "dance":
      return dancePose(t, tempo);
    case "video":
      return video ? keyframePose(video, t) : weighPose(idlePose(0), 0);
  }
};

/**
 * The rate that sets a clip's speed, or null when none does: a new rate
 * re-expresses the time already played (`retimeRate`), so the cycle carries
 * on from where it was instead of jumping.
 */
export const clipRate = (clip: MotionClip, rates: ClipRates): number | null => {
  switch (clip) {
    case "walk":
      return rates.cadence ?? DEFAULT_WALK.cadence;
    case "run":
      return rates.cadence ?? DEFAULT_RUN.cadence;
    case "cycle":
      return rates.cadence ?? DEFAULT_CYCLE.rpm;
    case "sleep":
      return rates.breathsPerMinute;
    default:
      return null;
  }
};

/** Seconds played at `from` cycles a minute, re-expressed at `to`, so the phase is the same. */
export const retimeRate = (elapsed: number, from: number, to: number): number =>
  to > 0 ? (elapsed * from) / to : elapsed;
