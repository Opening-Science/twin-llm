import { resolveActorId } from "@/infrastructure/auth-actor";

import { ouraAppConfig } from "@/features/oura/connection";
import {
  createOuraAuthorizeHandler,
  readOuraCookies,
} from "@/features/oura/oauth-handlers";
import { ensureAppUser } from "@/infrastructure/current-user";

export const GET = createOuraAuthorizeHandler({
  resolveActorId,
  ensureAppUser,
  ouraAppConfig,
  readCookies: readOuraCookies,
  logError: console.error,
});
