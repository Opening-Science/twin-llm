import {
  findConnectionForUpload,
  openUploadSecret,
} from "@/features/vitronic/connection";
import { createSkipThrottle } from "@/features/vitronic/skip-throttle";
import { createVitronicUploadHandler } from "@/features/vitronic/upload-handler";
import { database } from "@/infrastructure/database";
import { vitronicEnv } from "@/infrastructure/env";
import { vaultOpenFor } from "@/infrastructure/vault-runtime";
import { append } from "@/packages/audit/append";

export const POST = createVitronicUploadHandler({
  vitronicEnv,
  findConnectionForUpload,
  vaultOpen: vaultOpenFor,
  openUploadSecret,
  appendAudit: (input) => append(database(), input),
  // One map per server process; a restart starts it empty.
  mayAuditSkip: createSkipThrottle({ now: Date.now }),
  logError: console.error,
});
