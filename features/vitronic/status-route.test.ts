import { describe, expect, test } from "bun:test";

import {
  createVitronicStatusGetHandler,
  type VitronicStatusDeps,
} from "./status-handler";

const OWNER = "user-owner";
let actor: string | null = OWNER;
let statusFail = false;

const configured = () => ({ encryptionKey: "synthetic", dataDir: null });

const statusDeps = (): VitronicStatusDeps => ({
  vitronicEnv: configured,
  resolveActorId: async () => actor,
  findAppUserId: async (clerkId: string) => (clerkId ? clerkId : null),
  getVitronicConnectionStatus: async () => {
    if (statusFail) {
      throw new Error("audit-down");
    }
    return {
      configured: true,
      connected: false,
      lastSyncAt: null,
      hasAvatar: false,
      tlsFingerprintPrefix: null,
      scanDate: null,
      properties: [],
    };
  },
});

describe("GET /api/vitronic/status", () => {
  test("append failure returns generic 502 without audit-down or Prisma text", async () => {
    actor = OWNER;
    statusFail = true;
    const res = await createVitronicStatusGetHandler(statusDeps())();
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body).toEqual({ error: "Could not load BodyLoop status." });
    const blob = JSON.stringify(body);
    expect(blob).not.toContain("audit-down");
    expect(blob.toLowerCase()).not.toContain("prisma");
  });
});
