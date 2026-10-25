import { resolveActorId } from "@/infrastructure/auth-actor";

import {
  exchangeAndPersistGoogleHealthCode,
  googleHealthAppConfig,
  syncGoogleHealthForUser,
} from "@/features/google-health/connection";
import {
  createGoogleHealthCallbackHandler,
  readGoogleHealthCookies,
} from "@/features/google-health/oauth-handlers";
import { ensureAppUser } from "@/infrastructure/current-user";
import { googleHealthEnv } from "@/infrastructure/env";

export const GET = createGoogleHealthCallbackHandler({
  isConfigured: () => Boolean(googleHealthEnv() && googleHealthAppConfig()),
  resolveActorId,
  ensureAppUser,
  readCookies: readGoogleHealthCookies,
  exchangeAndPersistCode: exchangeAndPersistGoogleHealthCode,
  syncForUser: syncGoogleHealthForUser,
  logError: console.error,
  logWarn: console.warn,
});
