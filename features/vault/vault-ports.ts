import "server-only";

import { resolveActorId } from "@/infrastructure/auth-actor";
import { vaultEnv } from "@/infrastructure/env";
import { argon2Available } from "@/infrastructure/vault-crypto";
import { readVaultRecord, writeVaultRecord } from "@/infrastructure/vault-file";
import {
  appendVaultEvent,
  startIdleSweep,
  vaultGateDeps,
  vaultSetupState,
} from "@/infrastructure/vault-runtime";
import { vaultSessions } from "@/infrastructure/vault-session";

import { createVaultHandlers } from "./vault-handlers";
import { type VaultServiceDeps } from "./vault-service";

/** The vault routes wired to the state directory, the session store and the audit chain. */
const serviceDeps = (): VaultServiceDeps => ({
  read: (actorId) => readVaultRecord(vaultEnv().stateDir, actorId),
  write: (actorId, record) => writeVaultRecord(vaultEnv().stateDir, actorId, record),
  sessions: vaultSessions(),
  audit: appendVaultEvent,
  now: () => new Date(),
  argon2: argon2Available(),
  onOpened: () => {
    startIdleSweep();
  },
});

export const vaultHandlers = createVaultHandlers({
  dataMode: () => vaultEnv().dataMode,
  actorId: resolveActorId,
  service: serviceDeps,
  sessions: vaultSessions,
  idleMs: () => vaultEnv().idleLockMs,
  setupState: vaultSetupState,
  onIdleLock: (actorId) => vaultGateDeps().onIdleLock(actorId),
  logError: (message, name) => console.error(message, name),
});
