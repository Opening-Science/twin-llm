import { persistVitronicConnection } from "@/features/vitronic/connection";
import { createVitronicConnectHandler } from "@/features/vitronic/connect-handler";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { ensureAppUser } from "@/infrastructure/current-user";
import { vitronicEnv } from "@/infrastructure/env";
import { withUnlocked } from "@/infrastructure/vault-runtime";

export const POST = withUnlocked(
  createVitronicConnectHandler({
    vitronicEnv,
    resolveActorId,
    ensureAppUser,
    persistVitronicConnection,
  }),
);
