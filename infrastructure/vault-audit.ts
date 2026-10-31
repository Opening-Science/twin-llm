import type { AppendInput } from "@/packages/audit/append";

/**
 * Audit rows for the local unlock (#142). Ids and counts only: never a
 * passphrase, a code, a key, a key id or a hash of one. The event is in the
 * tool name, because the chain stores args only as a hash. A refused attempt
 * carries how many wrong attempts in a row this one makes (`rowCount`).
 */

export const VAULT_AUDIT_TOOLS = {
  setup: "vault.setup",
  unlock: "vault.unlock",
  unlockRefused: "vault.unlock.refused",
  lockManual: "vault.lock.manual",
  lockIdle: "vault.lock.idle",
  recoveryUsed: "vault.recovery_used",
  recoveryRefused: "vault.recovery.refused",
} as const;

export type VaultAuditEvent = keyof typeof VAULT_AUDIT_TOOLS;

export const vaultAuditEvent = (
  actorId: string,
  event: VaultAuditEvent,
  failures = 0,
): AppendInput => ({
  actor: actorId,
  sessionId: actorId,
  subjectRef: null,
  tool: VAULT_AUDIT_TOOLS[event],
  args: { event },
  result: { failures },
  rowCount: failures,
});
