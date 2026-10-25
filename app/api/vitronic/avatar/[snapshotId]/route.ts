import { loadAvatarForSnapshot } from "@/features/vitronic/connection";
import { createVitronicAvatarHandler } from "@/features/vitronic/avatar-handler";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { findAppUserId } from "@/infrastructure/current-user";

export const GET = createVitronicAvatarHandler({
  resolveActorId,
  findAppUserId,
  loadAvatarForSnapshot,
});
