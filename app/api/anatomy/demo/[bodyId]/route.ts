import { createDemoBodyHandler } from "@/features/digital-twin/anatomy/atlas-handler";
import { openDemoBody } from "@/packages/anatomy/atlas-store";

export const GET = createDemoBodyHandler({ openDemoBody });
