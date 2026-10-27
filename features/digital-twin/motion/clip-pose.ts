import { dancePose, DEFAULT_TEMPO } from "./dance";
import {
  type BodyPose,
  idlePose,
  type MotionClip,
  runPose,
  walkPose,
  weighPose,
} from "./gait";
import { type KeyframeClip, keyframePose } from "./keyframe-clip";

/**
 * The pose of a clip at `t` seconds; `tempo` (beats a minute) drives only the
 * dance loop, and `video` is the installed keyframe clip the "video" clip
 * plays (without one it stands at rest, though the toolbar never offers it).
 */
export const clipPose = (
  clip: MotionClip,
  t: number,
  tempo: number = DEFAULT_TEMPO,
  video: KeyframeClip | null = null,
): BodyPose => {
  switch (clip) {
    case "walk":
      return walkPose(t);
    case "run":
      return runPose(t);
    case "idle":
      return idlePose(t);
    case "dance":
      return dancePose(t, tempo);
    case "video":
      return video ? keyframePose(video, t) : weighPose(idlePose(0), 0);
  }
};
