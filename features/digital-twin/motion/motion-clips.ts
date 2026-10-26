/**
 * The keyframe clips the app knows how to find. A clip is made on this machine
 * by `python/motion/video_to_clip.py` and lives in the gitignored
 * `data/motion/`, because a clip traced from someone else's video carries that
 * video's rights and must not be committed. The list is closed, so a request
 * can never name an arbitrary file.
 */
export const MOTION_CLIP_IDS = ["video-dance"] as const;

export type MotionClipId = (typeof MOTION_CLIP_IDS)[number];

export const MOTION_CLIP_FILES: Readonly<Record<MotionClipId, string>> = {
  "video-dance": "video-dance.json",
};

export const isMotionClipId = (value: unknown): value is MotionClipId =>
  typeof value === "string" && (MOTION_CLIP_IDS as readonly string[]).includes(value);

export type MotionClipStatus = Readonly<{
  clips: readonly Readonly<{ id: MotionClipId; installed: boolean }>[];
}>;

/** Whether the status says a clip is installed; anything odd counts as not. */
export const clipInstalled = (value: unknown, id: MotionClipId): boolean => {
  const rows: unknown =
    value && typeof value === "object" ? (value as { clips?: unknown }).clips : null;
  if (!Array.isArray(rows)) return false;
  return (rows as readonly unknown[]).some(
    (row) =>
      row !== null &&
      typeof row === "object" &&
      (row as { id?: unknown }).id === id &&
      (row as { installed?: unknown }).installed === true,
  );
};
