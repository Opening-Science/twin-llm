import { dancePose, DEFAULT_TEMPO } from "./dance";
import { type BodyPose, idlePose, type MotionClip, walkPose } from "./gait";

/** The pose of a clip at `t` seconds; `tempo` (beats a minute) drives only the dance. */
export const clipPose = (
  clip: MotionClip,
  t: number,
  tempo: number = DEFAULT_TEMPO,
): BodyPose => {
  switch (clip) {
    case "walk":
      return walkPose(t);
    case "idle":
      return idlePose(t);
    case "dance":
      return dancePose(t, tempo);
  }
};
