import { resolveActorId } from "@/infrastructure/auth-actor";

import {
  createTokenHandlerFromCode,
  persistOuraTokens,
  syncOuraForUser,
} from "@/features/oura/connection";
import {
  createOuraCallbackHandler,
  readOuraCookies,
} from "@/features/oura/oauth-handlers";
import { ensureAppUser } from "@/infrastructure/current-user";
import { ouraEnv } from "@/infrastructure/env";

export const GET = createOuraCallbackHandler({
  ouraEnv,
  resolveActorId,
  ensureAppUser,
  readCookies: readOuraCookies,
  createTokenHandlerFromCode,
  persistOuraTokens,
  syncOuraForUser,
  logError: console.error,
  logWarn: console.warn,
});
