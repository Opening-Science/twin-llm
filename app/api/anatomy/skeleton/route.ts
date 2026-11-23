import { createSkeletonHandler } from "@/features/digital-twin/anatomy/skeleton-handler";
import { openSkeleton, skeletonSha256 } from "@/packages/anatomy/skeleton-store";

export const GET = createSkeletonHandler({ skeletonSha256, openSkeleton });
