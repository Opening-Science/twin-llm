import { createAnatomyEffectHandler } from "@/features/digital-twin/anatomy/atlas-handler";
import { openEffect } from "@/packages/anatomy/atlas-store";

export const GET = createAnatomyEffectHandler({ openEffect });
