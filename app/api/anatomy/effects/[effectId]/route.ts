import { createAnatomyEffectHandler } from "@/features/digital-twin/anatomy/atlas-handler";
import { openGlucoseEffect } from "@/packages/anatomy/effect-store";

export const GET = createAnatomyEffectHandler({ openEffect: openGlucoseEffect });
