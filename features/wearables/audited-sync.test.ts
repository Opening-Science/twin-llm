import { describe, expect, test } from "bun:test";

import type { PersonalRead } from "@/infrastructure/personal-read-audit";

import { auditThenSave, syncPurpose } from "./audited-sync";

const SYNCED = {
  metrics: [
    { key: "synthetic.a", value: 1 },
    { key: "synthetic.b", value: 2 },
  ],
  narrative: "Synthetic wearable context.",
};

/** A fake sync that records each step in `order`. */
const prepared = (order: string[]) => async () => {
  order.push("fetch");
  return {
    synced: SYNCED,
    save: async () => {
      order.push("save");
    },
  };
};

describe("auditThenSave", () => {
  test("fetches, writes one row counting the metrics, then saves and returns the sync", async () => {
    const order: string[] = [];
    const rows: PersonalRead[] = [];
    const result = await auditThenSave(
      prepared(order),
      "whoop",
      "user_synthetic_1",
      async (read) => {
        order.push("audit");
        rows.push(read);
      },
    );

    expect(result).toBe(SYNCED);
    expect(order).toEqual(["fetch", "audit", "save"]);
    expect(rows).toEqual([
      { actor: "user_synthetic_1", purpose: "sync-whoop", rowCount: 2 },
    ]);
    expect(JSON.stringify(rows)).not.toContain(SYNCED.narrative);
  });

  test("a failed fetch writes no row and saves nothing", async () => {
    const rows: PersonalRead[] = [];
    const run = auditThenSave(
      async () => {
        throw new Error("sync failed");
      },
      "oura",
      "user_synthetic_1",
      async (read) => {
        rows.push(read);
      },
    );

    await expect(run).rejects.toThrow("sync failed");
    expect(rows).toEqual([]);
  });

  test("a failed row rejects and saves nothing, so no snapshot is stored unlogged", async () => {
    const order: string[] = [];
    const run = auditThenSave(
      prepared(order),
      "google-health",
      "user_synthetic_1",
      async () => {
        throw new Error("audit down");
      },
    );

    await expect(run).rejects.toThrow("audit down");
    expect(order).toEqual(["fetch"]);
  });

  test("a failed save after the row rejects, and the row stays", async () => {
    const rows: PersonalRead[] = [];
    const run = auditThenSave(
      async () => ({
        synced: SYNCED,
        save: async () => {
          throw new Error("database down");
        },
      }),
      "oura",
      "user_synthetic_1",
      async (read) => {
        rows.push(read);
      },
    );

    await expect(run).rejects.toThrow("database down");
    expect(rows.map((row) => row.rowCount)).toEqual([2]);
  });
});

describe("syncPurpose", () => {
  test("names the provider, so the tool says which wearable synced", () => {
    expect(syncPurpose("oura")).toBe("sync-oura");
    expect(syncPurpose("whoop")).toBe("sync-whoop");
    expect(syncPurpose("google-health")).toBe("sync-google-health");
  });
});
