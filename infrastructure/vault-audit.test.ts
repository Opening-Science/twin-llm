import { describe, expect, test } from "bun:test";

import { VAULT_AUDIT_TOOLS, vaultAuditEvent } from "./vault-audit";

describe("vault audit rows (#142)", () => {
  test("ids and counts only; the event is in the tool name", () => {
    expect(vaultAuditEvent("actor-a", "unlockRefused", 3)).toEqual({
      actor: "actor-a",
      sessionId: "actor-a",
      subjectRef: null,
      tool: "vault.unlock.refused",
      args: { event: "unlockRefused" },
      result: { failures: 3 },
      rowCount: 3,
    });
    expect(vaultAuditEvent("actor-a", "unlock").rowCount).toBe(0);
  });

  test("the tool names", () => {
    expect(Object.values(VAULT_AUDIT_TOOLS)).toEqual([
      "vault.setup",
      "vault.unlock",
      "vault.unlock.refused",
      "vault.lock.manual",
      "vault.lock.idle",
      "vault.recovery_used",
      "vault.recovery.refused",
    ]);
  });
});
