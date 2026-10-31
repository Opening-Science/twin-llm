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
  /** #141: an existing install's rows sealed in place (`bun run vault:migrate`). */
  migrate: "vault.migrate",
  /** #141: a new data key made, the old one retiring (`bun run vault:rotate`). */
  rotateStart: "vault.rotate.start",
  /** #141: every row resealed under the new key and the old key removed. */
  rotate: "vault.rotate",
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

/**
 * A migration or rotation row (#141): how many rows per table and how many
 * mesh files were sealed. Table names and counts only.
 */
export const vaultCountsEvent = (
  actorId: string,
  event: "migrate" | "rotateStart" | "rotate",
  counts: Readonly<Record<string, number>>,
): AppendInput => {
  const rows = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return {
    actor: actorId,
    sessionId: actorId,
    subjectRef: null,
    tool: VAULT_AUDIT_TOOLS[event],
    args: { event },
    result: { counts },
    rowCount: rows,
  };
};
