import { resolveActorId } from "@/infrastructure/auth-actor";

import {
  exchangeAndPersistWhoopCode,
  syncWhoopForUser,
  whoopAppConfig,
} from "@/features/whoop/connection";
import {
  createWhoopCallbackHandler,
  readWhoopCookies,
} from "@/features/whoop/oauth-handlers";
import { ensureAppUser } from "@/infrastructure/current-user";
import { whoopEnv } from "@/infrastructure/env";
import { database } from "@/infrastructure/database";
import { auditPersonalRead } from "@/infrastructure/personal-read-audit";
import { append } from "@/packages/audit/append";

export const GET = createWhoopCallbackHandler({
  isConfigured: () => Boolean(whoopEnv() && whoopAppConfig()),
  resolveActorId,
  ensureAppUser,
  readCookies: readWhoopCookies,
  exchangeAndPersistCode: exchangeAndPersistWhoopCode,
  syncForUser: syncWhoopForUser,
  auditPersonalRead: auditPersonalRead((input) => append(database(), input)),
  logError: console.error,
  logWarn: console.warn,
});
