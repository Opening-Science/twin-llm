import { resolveActorId } from "@/infrastructure/auth-actor";

import { createWearableSyncHandler } from "@/features/wearables/sync-handler";
import { syncWhoopForUser } from "@/features/whoop/connection";
import { findAppUserId } from "@/infrastructure/current-user";
import { whoopEnv } from "@/infrastructure/env";
import { database } from "@/infrastructure/database";
import { recordDisclosure } from "@/infrastructure/disclosure-ledger-runtime";
import { auditPersonalRead } from "@/infrastructure/personal-read-audit";
import { append } from "@/packages/audit/append";
import { withUnlocked } from "@/infrastructure/vault-runtime";

export const POST = withUnlocked(
  createWearableSyncHandler({
    provider: "whoop",
    isConfigured: () => Boolean(whoopEnv()),
    resolveActorId,
    findAppUserId,
    sync: (userId, { startDate, endDate }) =>
      syncWhoopForUser(userId, { startDate, endDate }),
    auditPersonalRead: auditPersonalRead((input) => append(database(), input)),
    recordDisclosure,
    logError: console.error,
  }),
);
