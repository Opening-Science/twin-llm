import { loadAvatarForSnapshot } from "@/features/vitronic/connection";
import { createVitronicAvatarHandler } from "@/features/vitronic/avatar-handler";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { findAppUserId } from "@/infrastructure/current-user";
import { withUnlocked } from "@/infrastructure/vault-runtime";

export const GET = withUnlocked(
  createVitronicAvatarHandler({
    resolveActorId,
    findAppUserId,
    loadAvatarForSnapshot,
  }),
);
