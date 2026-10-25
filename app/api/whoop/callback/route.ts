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

export const GET = createWhoopCallbackHandler({
  isConfigured: () => Boolean(whoopEnv() && whoopAppConfig()),
  resolveActorId,
  ensureAppUser,
  readCookies: readWhoopCookies,
  exchangeAndPersistCode: exchangeAndPersistWhoopCode,
  syncForUser: syncWhoopForUser,
  logError: console.error,
  logWarn: console.warn,
});
