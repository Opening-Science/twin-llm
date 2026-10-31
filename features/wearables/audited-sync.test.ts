import { describe, expect, test } from "bun:test";

import type { PersonalRead } from "@/infrastructure/personal-read-audit";

import {
  auditThenSave,
  syncPurpose,
  vendorAuthDisclosure,
  vendorSyncDisclosure,
} from "./audited-sync";

/** A ledger write that succeeds. */
const disclosed = async () => ({ seq: 1n, auditSeq: 1n });

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
      disclosed,
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
      disclosed,
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
      disclosed,
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
      disclosed,
    );

    await expect(run).rejects.toThrow("database down");
    expect(rows.map((row) => row.rowCount)).toEqual([2]);
  });
});

describe("auditThenSave and the disclosure ledger (#140)", () => {
  test("the request is in the ledger before anything is fetched", async () => {
    const order: string[] = [];
    await auditThenSave(
      prepared(order),
      "oura",
      "user_synthetic_1",
      async () => {
        order.push("audit");
      },
      async () => {
        order.push("ledger");
      },
    );
    expect(order).toEqual(["ledger", "fetch", "audit", "save"]);
  });

  test("a ledger that cannot be written stops the sync before the fetch", async () => {
    const order: string[] = [];
    const run = auditThenSave(
      prepared(order),
      "whoop",
      "user_synthetic_1",
      async () => {
        order.push("audit");
      },
      async () => {
        throw new Error("ledger down");
      },
    );
    await expect(run).rejects.toThrow("ledger down");
    expect(order).toEqual([]);
  });

  test("a sync sends the token and the date window, no health value", () => {
    expect(vendorSyncDisclosure("google-health", "user_synthetic_1")).toEqual({
      actor: "user_synthetic_1",
      sessionId: "sync-google-health",
      kind: "vendor-sync",
      recipient: "Google Health",
      target: "data download",
      purpose: "sync",
      categories: ["access token", "date window"],
      refs: [],
      payloadBytes: null,
      threadId: null,
      synthetic: false,
    });
    expect(vendorSyncDisclosure("oura", "user_synthetic_1", { sandbox: true })).toEqual({
      actor: "user_synthetic_1",
      sessionId: "sync-oura",
      kind: "vendor-sync",
      recipient: "Oura",
      target: "sandbox data download",
      purpose: "sync",
      categories: ["access token", "date window"],
      refs: [],
      payloadBytes: null,
      threadId: null,
      synthetic: true,
    });
  });

  test("connecting sends the authorization code", () => {
    expect(vendorAuthDisclosure("whoop", "user_synthetic_1")).toEqual({
      actor: "user_synthetic_1",
      sessionId: "connect-whoop",
      kind: "vendor-auth",
      recipient: "Whoop",
      target: "token exchange",
      purpose: "connect",
      categories: ["authorization code"],
      refs: [],
      payloadBytes: null,
      threadId: null,
      synthetic: false,
    });
  });
});

describe("syncPurpose", () => {
  test("names the provider, so the tool says which wearable synced", () => {
    expect(syncPurpose("oura")).toBe("sync-oura");
    expect(syncPurpose("whoop")).toBe("sync-whoop");
    expect(syncPurpose("google-health")).toBe("sync-google-health");
  });
});
