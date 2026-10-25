import { createAnatomyAtlasHandler } from "@/features/digital-twin/anatomy/atlas-handler";
import { openAtlas } from "@/packages/anatomy/atlas-store";

export const GET = createAnatomyAtlasHandler({ openAtlas });
