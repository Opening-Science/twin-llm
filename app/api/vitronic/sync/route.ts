import {
  ingestVitronicForUser,
  syncVitronicForUser,
} from "@/features/vitronic/connection";
import { createVitronicSyncHandler } from "@/features/vitronic/sync-handler";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { findAppUserId } from "@/infrastructure/current-user";
import { vitronicEnv } from "@/infrastructure/env";

export const POST = createVitronicSyncHandler({
  vitronicEnv,
  resolveActorId,
  findAppUserId,
  ingestVitronicForUser,
  syncVitronicForUser,
});
