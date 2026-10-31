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
import { database } from "@/infrastructure/database";
import { recordDisclosure } from "@/infrastructure/disclosure-ledger-runtime";
import { auditPersonalRead } from "@/infrastructure/personal-read-audit";
import { vaultOpenFor } from "@/infrastructure/vault-runtime";
import { append } from "@/packages/audit/append";

export const GET = createGoogleHealthCallbackHandler({
  isConfigured: () => Boolean(googleHealthEnv() && googleHealthAppConfig()),
  resolveActorId,
  ensureAppUser,
  readCookies: readGoogleHealthCookies,
  exchangeAndPersistCode: exchangeAndPersistGoogleHealthCode,
  syncForUser: syncGoogleHealthForUser,
  auditPersonalRead: auditPersonalRead((input) => append(database(), input)),
  recordDisclosure,
  mayReadPersonal: vaultOpenFor,
  logError: console.error,
  logWarn: console.warn,
});
