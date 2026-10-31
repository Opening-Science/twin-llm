import { listScansForSubject } from "@/features/vitronic/connection";
import { createVitronicScansHandler } from "@/features/vitronic/scans-handler";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { findAppUserId } from "@/infrastructure/current-user";
import { vitronicEnv } from "@/infrastructure/env";
import { withUnlocked } from "@/infrastructure/vault-runtime";

export const GET = withUnlocked(
  createVitronicScansHandler({
    vitronicEnv,
    resolveActorId,
    findAppUserId,
    listScansForSubject,
  }),
);
