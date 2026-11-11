import { createSkeletonHandler } from "@/features/digital-twin/anatomy/skeleton-handler";
import { openSkeleton, statSkeleton } from "@/packages/anatomy/skeleton-store";

export const GET = createSkeletonHandler({ statSkeleton, openSkeleton });
