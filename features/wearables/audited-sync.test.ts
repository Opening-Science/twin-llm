import { describe, expect, test } from "bun:test";

import type { PersonalRead } from "@/infrastructure/personal-read-audit";

import { syncThenAudit } from "./audited-sync";

const SYNCED = {
  metrics: [
    { key: "synthetic.a", value: 1 },
    { key: "synthetic.b", value: 2 },
  ],
  narrative: "Synthetic wearable context.",
};

describe("syncThenAudit", () => {
  test("syncs, then writes one sync row counting the metrics, and returns the sync", async () => {
    const order: string[] = [];
    const rows: PersonalRead[] = [];
    const result = await syncThenAudit(
      async () => {
        order.push("sync");
        return SYNCED;
      },
      "user_synthetic_1",
      async (read) => {
        order.push("audit");
        rows.push(read);
      },
    );

    expect(result).toBe(SYNCED);
    expect(order).toEqual(["sync", "audit"]);
    expect(rows).toEqual([{ actor: "user_synthetic_1", purpose: "sync", rowCount: 2 }]);
    expect(JSON.stringify(rows)).not.toContain(SYNCED.narrative);
  });

  test("a failed sync writes no row", async () => {
    const rows: PersonalRead[] = [];
    const run = syncThenAudit(
      async () => {
        throw new Error("sync failed");
      },
      "user_synthetic_1",
      async (read) => {
        rows.push(read);
      },
    );

    await expect(run).rejects.toThrow("sync failed");
    expect(rows).toEqual([]);
  });

  test("a failed row rejects", async () => {
    const run = syncThenAudit(
      async () => SYNCED,
      "user_synthetic_1",
      async () => {
        throw new Error("audit down");
      },
    );

    await expect(run).rejects.toThrow("audit down");
  });
});
