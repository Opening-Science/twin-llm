import { resolveActorId } from "@/infrastructure/auth-actor";

import {
  buildGoogleHealthAuthorizeUrl,
  createGoogleHealthOAuthState,
  googleHealthAppConfig,
} from "@/features/google-health/connection";
import {
  createGoogleHealthAuthorizeHandler,
  readGoogleHealthCookies,
} from "@/features/google-health/oauth-handlers";
import { ensureAppUser } from "@/infrastructure/current-user";

export const GET = createGoogleHealthAuthorizeHandler({
  resolveActorId,
  ensureAppUser,
  googleHealthAppConfig,
  createState: createGoogleHealthOAuthState,
  buildAuthorizeUrl: buildGoogleHealthAuthorizeUrl,
  readCookies: readGoogleHealthCookies,
  logError: console.error,
});
