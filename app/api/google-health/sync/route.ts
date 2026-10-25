import { resolveActorId } from "@/infrastructure/auth-actor";

import { syncGoogleHealthForUser } from "@/features/google-health/connection";
import { createWearableSyncHandler } from "@/features/wearables/sync-handler";
import { findAppUserId } from "@/infrastructure/current-user";
import { googleHealthEnv } from "@/infrastructure/env";

export const POST = createWearableSyncHandler({
  provider: "google-health",
  isConfigured: () => Boolean(googleHealthEnv()),
  resolveActorId,
  findAppUserId,
  sync: (userId, { startDate, endDate }) =>
    syncGoogleHealthForUser(userId, { startDate, endDate }),
  logError: console.error,
});
