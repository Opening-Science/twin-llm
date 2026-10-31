import "server-only";

import { cookies } from "next/headers";

import { append } from "@/packages/audit/append";

import { resolveActorId } from "./auth-actor";
import { database } from "./database";
import { vaultEnv } from "./env";
import { processSingleton } from "./process-singleton";
import { vaultAuditEvent, type VaultAuditEvent } from "./vault-audit";
import { readVaultRecord } from "./vault-file";
import {
  checkVault,
  createWithUnlocked,
  VAULT_COOKIE,
  type VaultDecision,
  type VaultGateDeps,
  type VaultSetupState,
} from "./vault-gate";
import { vaultSessions } from "./vault-session";

/**
 * The gate of `vault-gate.ts` wired to this server: the env's data mode and
 * idle time, the signed-in actor, the process's session store, the key file
 * in the state directory and the audit chain. Route files use
 * `withUnlocked`; pages and server actions use `vaultDecisionForPage` and
 * `vaultRefusalForAction`, which read the cookie through `next/headers`.
 */

const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : typeof error;

/** Appends one vault row; the caller decides what a failure means. */
export const appendVaultEvent = (
  actorId: string,
  event: VaultAuditEvent,
  failures = 0,
): Promise<unknown> => append(database(), vaultAuditEvent(actorId, event, failures));

const recordIdleLock = (actorId: string): Promise<void> =>
  appendVaultEvent(actorId, "lockIdle").then(
    () => undefined,
    (error: unknown) => {
      console.error("[vault] idle lock row not written", errorName(error));
    },
  );

export const vaultSetupState = async (actorId: string): Promise<VaultSetupState> => {
  const read = await readVaultRecord(vaultEnv().stateDir, actorId);
  if (read.kind === "found") return "set-up";
  if (read.kind === "missing") return "not-set-up";
  console.error("[vault] key file unreadable");
  return "unreadable";
};

export const vaultGateDeps = (): VaultGateDeps => ({
  dataMode: () => vaultEnv().dataMode,
  actorId: resolveActorId,
  sessions: vaultSessions,
  idleMs: () => vaultEnv().idleLockMs,
  setupState: vaultSetupState,
  onIdleLock: recordIdleLock,
});

/** Wrap every personal route's handler: `export const GET = withUnlocked(handler)`. */
export const withUnlocked = createWithUnlocked(vaultGateDeps);

const cookieToken = async (): Promise<string | null> =>
  (await cookies()).get(VAULT_COOKIE)?.value ?? null;

/** The gate for a server component page; pages show the unlock screen on a refusal. */
export const vaultDecisionForPage = async (): Promise<VaultDecision> =>
  checkVault(vaultGateDeps(), await cookieToken());

/** The gate for a server action: the plain sentence to show, or null to go on. */
export const vaultRefusalForAction = async (): Promise<string | null> => {
  const decision = await checkVault(vaultGateDeps(), await cookieToken());
  return decision.ok ? null : decision.message;
};

export type VaultShellState = Readonly<{ personal: boolean; unlocked: boolean }>;

/**
 * For the sidebar and the lock control: whether this browser holds an open
 * session. Reading it is not use, so a page that reads nothing personal (the
 * Lab, the docs) does not keep the vault from locking when idle.
 */
export const vaultShellState = async (): Promise<VaultShellState> => {
  if (vaultEnv().dataMode !== "personal") return { personal: false, unlocked: true };
  const actorId = await resolveActorId();
  if (actorId === null) return { personal: true, unlocked: false };
  return {
    personal: true,
    unlocked: vaultSessions().holds(actorId, await cookieToken(), vaultEnv().idleLockMs),
  };
};

/** True when the actor's vault is open in this process, whatever cookie came with the request. */
export const vaultOpenFor = (actorId: string): boolean =>
  vaultEnv().dataMode !== "personal" ||
  vaultSessions().isOpen(actorId, vaultEnv().idleLockMs);

const SWEEP_EVERY_MS = 60_000;

/**
 * Locks idle vaults once a minute even when no request comes, so the data
 * key does not stay in memory past the idle time. Started on the first
 * unlock; the timer does not keep the process alive.
 */
export const startIdleSweep: () => true = processSingleton(
  "__twinLlmVaultIdleSweep",
  () => {
    const timer = setInterval(() => {
      for (const actorId of vaultSessions().sweep(vaultEnv().idleLockMs)) {
        void recordIdleLock(actorId);
      }
    }, SWEEP_EVERY_MS);
    timer.unref();
    return true as const;
  },
);
