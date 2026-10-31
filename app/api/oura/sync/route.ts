import { resolveActorId } from "@/infrastructure/auth-actor";

import { syncOuraForUser } from "@/features/oura/connection";
import { createWearableSyncHandler } from "@/features/wearables/sync-handler";
import { findAppUserId } from "@/infrastructure/current-user";
import { ouraEnv } from "@/infrastructure/env";
import { database } from "@/infrastructure/database";
import { recordDisclosure } from "@/infrastructure/disclosure-ledger-runtime";
import { auditPersonalRead } from "@/infrastructure/personal-read-audit";
import { append } from "@/packages/audit/append";
import { withUnlocked } from "@/infrastructure/vault-runtime";

export const POST = withUnlocked(
  createWearableSyncHandler({
    provider: "oura",
    isConfigured: () => Boolean(ouraEnv()),
    resolveActorId,
    findAppUserId,
    sync: (userId, { sandbox, startDate, endDate }) =>
      syncOuraForUser(userId, { sandbox: Boolean(sandbox), startDate, endDate }),
    auditPersonalRead: auditPersonalRead((input) => append(database(), input)),
    recordDisclosure,
    logError: console.error,
  }),
);
