import { createFittedAtlasHandler } from "@/features/digital-twin/anatomy/atlas-handler";
import { openFittedAtlas } from "@/packages/anatomy/atlas-store";

export const GET = createFittedAtlasHandler({ openFittedAtlas });
