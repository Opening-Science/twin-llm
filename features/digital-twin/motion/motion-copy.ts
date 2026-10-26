import { formatNumber } from "@/infrastructure/format-measure";

import { type MotionClip } from "./gait";

/**
 * Copy for whole-body motion, in one place so `lint:claims` sees it. The clips
 * are generic and computed; the copy never suggests they are this person's gait
 * or breathing.
 */
export const MOTION_LABEL: Readonly<Record<MotionClip, string>> = {
  walk: "Walk",
  idle: "Idle",
  dance: "Dance",
};

export const MOTION_LINE: Readonly<Record<MotionClip, string>> = {
  walk: "A generic walk cycle, computed from typical joint angles, not this person's gait. Walking in place.",
  idle: "A generic standing breath and sway, not this person's breathing.",
  dance: "A computed dance loop, not motion capture and not this person's movement.",
};

export const TEMPO_LABEL = "Tempo";
export const tempoOption = (bpm: number): string => `${formatNumber(bpm, 0)} BPM`;

export const MOTION_HIDES_ANATOMY =
  "Anatomy layers are hidden while the body moves: they cannot follow its joints.";

export const MOTION_REDUCED = "Motion is off because the system asks for reduced motion.";
/**
 * The demo body loads without a skeleton only when the rigged copy was never
 * baked on this machine, so the reason names the command that bakes it.
 */
export const MOTION_NO_RIG_DEMO =
  "The demo body that can walk is not installed on this machine. Run bun run anatomy:bake-rigged (needs uv).";
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
