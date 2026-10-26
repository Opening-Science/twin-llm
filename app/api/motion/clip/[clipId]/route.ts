import { createMotionClipHandler } from "@/features/digital-twin/motion/clip-handler";
import { readMotionClip } from "@/features/digital-twin/motion/clip-store";

export const GET = createMotionClipHandler({ readClip: readMotionClip });
