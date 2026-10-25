import { createAnatomyStatusHandler } from "@/features/digital-twin/anatomy/status-handler";
import { statAtlas } from "@/packages/anatomy/atlas-store";

export const GET = createAnatomyStatusHandler({ statAtlas });
