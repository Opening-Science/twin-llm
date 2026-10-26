import { createMotionStatusHandler } from "@/features/digital-twin/motion/clip-handler";
import { statMotionClip } from "@/features/digital-twin/motion/clip-store";

export const GET = createMotionStatusHandler({ statClip: statMotionClip });
