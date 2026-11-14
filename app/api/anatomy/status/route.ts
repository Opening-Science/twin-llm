import { createAnatomyStatusHandler } from "@/features/digital-twin/anatomy/status-handler";
import { anatomyEnv } from "@/infrastructure/env";
import {
  statAtlas,
  statFittedAtlas,
  statRiggedBody,
} from "@/packages/anatomy/atlas-store";
import { readSkeletonStatus } from "@/packages/anatomy/skeleton-store";

export const GET = createAnatomyStatusHandler({
  statAtlas,
  statRiggedBody,
  statFittedAtlas,
  fittedAtlasOn: () => anatomyEnv().fittedAtlasOn,
  readSkeleton: readSkeletonStatus,
});
