import { getVitronicConnectionStatus } from "@/features/vitronic/connection";
import { createVitronicStatusGetHandler } from "@/features/vitronic/status-handler";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { findAppUserId } from "@/infrastructure/current-user";
import { vitronicEnv } from "@/infrastructure/env";
import { withUnlocked } from "@/infrastructure/vault-runtime";

const statusDeps = {
  vitronicEnv,
  resolveActorId,
  findAppUserId,
  getVitronicConnectionStatus,
};

export const GET = withUnlocked(createVitronicStatusGetHandler(statusDeps));
