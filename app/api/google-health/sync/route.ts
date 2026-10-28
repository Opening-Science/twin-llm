import { resolveActorId } from "@/infrastructure/auth-actor";

import { syncGoogleHealthForUser } from "@/features/google-health/connection";
import { createWearableSyncHandler } from "@/features/wearables/sync-handler";
import { findAppUserId } from "@/infrastructure/current-user";
import { googleHealthEnv } from "@/infrastructure/env";
import { database } from "@/infrastructure/database";
import { auditPersonalRead } from "@/infrastructure/personal-read-audit";
import { append } from "@/packages/audit/append";

export const POST = createWearableSyncHandler({
  provider: "google-health",
  isConfigured: () => Boolean(googleHealthEnv()),
  resolveActorId,
  findAppUserId,
  sync: (userId, { startDate, endDate }) =>
    syncGoogleHealthForUser(userId, { startDate, endDate }),
  auditPersonalRead: auditPersonalRead((input) => append(database(), input)),
  logError: console.error,
});
