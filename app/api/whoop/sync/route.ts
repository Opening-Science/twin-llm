import { resolveActorId } from "@/infrastructure/auth-actor";

import { createWearableSyncHandler } from "@/features/wearables/sync-handler";
import { syncWhoopForUser } from "@/features/whoop/connection";
import { findAppUserId } from "@/infrastructure/current-user";
import { whoopEnv } from "@/infrastructure/env";
import { database } from "@/infrastructure/database";
import { auditPersonalRead } from "@/infrastructure/personal-read-audit";
import { append } from "@/packages/audit/append";

export const POST = createWearableSyncHandler({
  provider: "whoop",
  isConfigured: () => Boolean(whoopEnv()),
  resolveActorId,
  findAppUserId,
  sync: (userId, { startDate, endDate }) =>
    syncWhoopForUser(userId, { startDate, endDate }),
  auditPersonalRead: auditPersonalRead((input) => append(database(), input)),
  logError: console.error,
});
