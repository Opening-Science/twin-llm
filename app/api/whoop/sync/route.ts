import { resolveActorId } from "@/infrastructure/auth-actor";

import { createWearableSyncHandler } from "@/features/wearables/sync-handler";
import { syncWhoopForUser } from "@/features/whoop/connection";
import { findAppUserId } from "@/infrastructure/current-user";
import { whoopEnv } from "@/infrastructure/env";

export const POST = createWearableSyncHandler({
  provider: "whoop",
  isConfigured: () => Boolean(whoopEnv()),
  resolveActorId,
  findAppUserId,
  sync: (userId, { startDate, endDate }) =>
    syncWhoopForUser(userId, { startDate, endDate }),
  logError: console.error,
});
