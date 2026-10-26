import { type MotionClip } from "./gait";

/**
 * Copy for whole-body motion, in one place so `lint:claims` sees it. The clips
 * are generic and computed; the copy never suggests they are this person's gait
 * or breathing.
 */
export const MOTION_LABEL: Readonly<Record<MotionClip, string>> = {
  walk: "Walk",
  idle: "Idle",
};

export const MOTION_LINE: Readonly<Record<MotionClip, string>> = {
  walk: "A generic walk cycle, computed from typical joint angles, not this person's gait. Walking in place.",
  idle: "A generic standing breath and sway, not this person's breathing.",
};

export const MOTION_HIDES_ANATOMY =
  "Anatomy layers are hidden while the body moves: they cannot follow its joints.";

export const MOTION_REDUCED = "Motion is off because the system asks for reduced motion.";
export const MOTION_NO_RIG_DEMO = "This demo body has no skeleton, so it cannot walk.";
export const MOTION_NO_RIG_SCAN = "This scan has no skeleton the walk can drive.";

/**
 * The lines beside the 3D view about motion: what plays and that it is
 * generic, that the anatomy layers are hidden meanwhile, or why nothing can
 * play on this body.
 */
export const motionLines = (
  control: Readonly<{ clip: MotionClip | null; unavailable: string | null }> | undefined,
  anatomyShown: boolean,
): readonly string[] => {
  if (!control) return [];
  if (control.unavailable !== null) return [control.unavailable];
  if (control.clip === null) return [];
  return anatomyShown
    ? [MOTION_LINE[control.clip], MOTION_HIDES_ANATOMY]
    : [MOTION_LINE[control.clip]];
};
