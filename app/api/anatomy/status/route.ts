import { createAnatomyStatusHandler } from "@/features/digital-twin/anatomy/status-handler";
import { statAtlas, statRiggedBody } from "@/packages/anatomy/atlas-store";
import { readSkeletonAtlas } from "@/packages/anatomy/skeleton-store";

export const GET = createAnatomyStatusHandler({
  statAtlas,
  statRiggedBody,
  readSkeleton: readSkeletonAtlas,
});
