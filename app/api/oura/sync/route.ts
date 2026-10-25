import { resolveActorId } from "@/infrastructure/auth-actor";

import { syncOuraForUser } from "@/features/oura/connection";
import { createWearableSyncHandler } from "@/features/wearables/sync-handler";
import { findAppUserId } from "@/infrastructure/current-user";
import { ouraEnv } from "@/infrastructure/env";

export const POST = createWearableSyncHandler({
  provider: "oura",
  isConfigured: () => Boolean(ouraEnv()),
  resolveActorId,
  findAppUserId,
  sync: (userId, { sandbox, startDate, endDate }) =>
    syncOuraForUser(userId, { sandbox: Boolean(sandbox), startDate, endDate }),
  logError: console.error,
});
