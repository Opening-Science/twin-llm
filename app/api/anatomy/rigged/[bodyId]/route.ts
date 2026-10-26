import { createRiggedBodyHandler } from "@/features/digital-twin/anatomy/atlas-handler";
import { openRiggedBody } from "@/packages/anatomy/atlas-store";

export const GET = createRiggedBodyHandler({ openRiggedBody });
