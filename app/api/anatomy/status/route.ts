import { createAnatomyStatusHandler } from "@/features/digital-twin/anatomy/status-handler";
import { anatomyEnv } from "@/infrastructure/env";
import {
  statAtlas,
  statFittedAtlas,
  statRiggedBody,
} from "@/packages/anatomy/atlas-store";

export const GET = createAnatomyStatusHandler({
  statAtlas,
  statRiggedBody,
  statFittedAtlas,
  fittedAtlasOn: () => anatomyEnv().fittedAtlasOn,
});
