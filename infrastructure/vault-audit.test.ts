import { describe, expect, test } from "bun:test";

import {
  LOCKED_SKIP_STEPS,
  lockedSkipEvent,
  lockedSkipTool,
  VAULT_AUDIT_TOOLS,
  vaultAuditEvent,
  vaultCountsEvent,
} from "./vault-audit";

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
      "vault.migrate",
      "vault.rotate.start",
      "vault.rotate",
    ]);
  });

  test("migration and rotation rows hold table names and counts only (#141)", () => {
    expect(
      vaultCountsEvent("actor-a", "migrate", { threads: 2, turns: 3, meshFiles: 1 }),
    ).toEqual({
      actor: "actor-a",
      sessionId: "actor-a",
      subjectRef: null,
      tool: "vault.migrate",
      args: { event: "migrate" },
      result: { counts: { threads: 2, turns: 3, meshFiles: 1 } },
      rowCount: 6,
    });
  });

  test("a step skipped while locked names the step in the tool (#341)", () => {
    expect(LOCKED_SKIP_STEPS.map(lockedSkipTool)).toEqual([
      "vault.locked.skip.connect-oura",
      "vault.locked.skip.connect-whoop",
      "vault.locked.skip.connect-google-health",
      "vault.locked.skip.bodyloop-upload",
    ]);
    expect(lockedSkipEvent("actor-a", "bodyloop-upload")).toEqual({
      actor: "actor-a",
      sessionId: "actor-a",
      subjectRef: null,
      tool: "vault.locked.skip.bodyloop-upload",
      args: { step: "bodyloop-upload" },
      result: { decision: "skipped: locked" },
      rowCount: 0,
    });
  });
});
