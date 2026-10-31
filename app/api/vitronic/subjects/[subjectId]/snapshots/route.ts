import { listSnapshotsForSubject } from "@/features/vitronic/connection";
import { createVitronicSnapshotsHandler } from "@/features/vitronic/snapshots-handler";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { findAppUserId } from "@/infrastructure/current-user";
import { vitronicEnv } from "@/infrastructure/env";
import { withUnlocked } from "@/infrastructure/vault-runtime";

export const GET = withUnlocked(
  createVitronicSnapshotsHandler({
    vitronicEnv,
    resolveActorId,
    findAppUserId,
    listSnapshotsForSubject,
  }),
);
