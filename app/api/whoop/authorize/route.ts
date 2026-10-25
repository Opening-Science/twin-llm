import { resolveActorId } from "@/infrastructure/auth-actor";
import { createWhoopOAuthState } from "@open-twin/provider-whoop";

import { buildWhoopAuthorizeUrl, whoopAppConfig } from "@/features/whoop/connection";
import {
  createWhoopAuthorizeHandler,
  readWhoopCookies,
} from "@/features/whoop/oauth-handlers";
import { ensureAppUser } from "@/infrastructure/current-user";

export const GET = createWhoopAuthorizeHandler({
  resolveActorId,
  ensureAppUser,
  whoopAppConfig,
  createState: createWhoopOAuthState,
  buildAuthorizeUrl: buildWhoopAuthorizeUrl,
  readCookies: readWhoopCookies,
  logError: console.error,
});
