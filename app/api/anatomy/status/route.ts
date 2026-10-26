import { createAnatomyStatusHandler } from "@/features/digital-twin/anatomy/status-handler";
import { statAtlas, statRiggedBody } from "@/packages/anatomy/atlas-store";

export const GET = createAnatomyStatusHandler({ statAtlas, statRiggedBody });
