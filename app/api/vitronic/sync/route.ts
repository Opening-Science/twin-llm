import {
  ingestVitronicForUser,
  syncVitronicForUser,
} from "@/features/vitronic/connection";
import { createVitronicSyncHandler } from "@/features/vitronic/sync-handler";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { findAppUserId } from "@/infrastructure/current-user";
import { vitronicEnv } from "@/infrastructure/env";
import { withUnlocked } from "@/infrastructure/vault-runtime";

export const POST = withUnlocked(
  createVitronicSyncHandler({
    vitronicEnv,
    resolveActorId,
    findAppUserId,
    ingestVitronicForUser,
    syncVitronicForUser,
  }),
);
