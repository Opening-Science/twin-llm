import { resolveActorId } from "@/infrastructure/auth-actor";
import { createMockDayHandler } from "@/features/digital-twin/day/day-handler";

export const GET = createMockDayHandler({ resolveActorId });
