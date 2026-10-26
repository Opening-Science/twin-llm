import "server-only";

import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { KEYFRAME_CLIP_MAX_BYTES } from "./keyframe-clip";
import { MOTION_CLIP_FILES, type MotionClipId } from "./motion-clips";

/** Where `python/motion/video_to_clip.py` is told to write clips (gitignored). */
export const MOTION_DATA_DIR = join("data", "motion");

const clipPath = (id: MotionClipId): string =>
  resolve(process.cwd(), MOTION_DATA_DIR, MOTION_CLIP_FILES[id]);

/** Whether the clip file is present and not larger than a clip may be. */
export const statMotionClip = async (id: MotionClipId): Promise<boolean> => {
  try {
    const info = await stat(clipPath(id));
    return info.isFile() && info.size > 0 && info.size <= KEYFRAME_CLIP_MAX_BYTES;
  } catch {
    return false;
  }
};

/** The clip file's text, or null when it is not installed. */
export const readMotionClip = async (id: MotionClipId): Promise<string | null> => {
  if (!(await statMotionClip(id))) return null;
  try {
    return await readFile(clipPath(id), "utf8");
  } catch {
    return null;
  }
};
