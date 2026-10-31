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
import { database } from "@/infrastructure/database";
import { recordDisclosure } from "@/infrastructure/disclosure-ledger-runtime";
import { auditPersonalRead } from "@/infrastructure/personal-read-audit";
import { vaultOpenFor } from "@/infrastructure/vault-runtime";
import { append } from "@/packages/audit/append";

export const GET = createOuraCallbackHandler({
  ouraEnv,
  resolveActorId,
  ensureAppUser,
  readCookies: readOuraCookies,
  createTokenHandlerFromCode,
  persistOuraTokens,
  syncOuraForUser,
  auditPersonalRead: auditPersonalRead((input) => append(database(), input)),
  recordDisclosure,
  mayReadPersonal: vaultOpenFor,
  appendAudit: (input) => append(database(), input),
  logError: console.error,
  logWarn: console.warn,
});
