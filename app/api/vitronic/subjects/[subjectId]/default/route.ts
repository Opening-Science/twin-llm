import { setDefaultScanForSubject } from "@/features/vitronic/connection";
import { createVitronicDefaultScanPutHandler } from "@/features/vitronic/default-scan-handler";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { findAppUserId } from "@/infrastructure/current-user";
import { vitronicEnv } from "@/infrastructure/env";
import { withUnlocked } from "@/infrastructure/vault-runtime";

export const PUT = withUnlocked(
  createVitronicDefaultScanPutHandler({
    vitronicEnv,
    resolveActorId,
    findAppUserId,
    setDefaultScanForSubject,
  }),
);
