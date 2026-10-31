import { database } from "../../infrastructure/database";
import { vaultAuditEvent, vaultCountsEvent } from "../../infrastructure/vault-audit";
import { append } from "../../packages/audit/append";

/**
 * The audit rows the vault CLIs write: `vault.setup` when a migration sets
 * the passphrase, and the migration and rotation rows with counts (#141).
 * A row that cannot be written stops the CLI before it changes anything.
 */
export const appendVaultCounts = async (
  actorId: string,
  event: "setup" | "migrate" | "rotateStart" | "rotate",
  counts: Readonly<Record<string, number>> = {},
): Promise<void> => {
  await append(
    database(),
    event === "setup"
      ? vaultAuditEvent(actorId, "setup")
      : vaultCountsEvent(actorId, event, counts),
  );
};
