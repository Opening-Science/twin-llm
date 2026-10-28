import { describe, expect, test } from "bun:test";

import {
  auditPersonalRead,
  personalReadEvent,
} from "@/infrastructure/personal-read-audit";
import type { AppendInput } from "@/packages/audit/append";

import { createWearablesSummaryHandler } from "./summary-handler";

const USER_ID = "user-synthetic-1";
const WHOOP_NARRATIVE = "Whoop wearable context for 2026-01-01 to 2026-01-04.";
const WEARABLES_SUMMARY_AUDIT_TOOL = "vitronic.wearables.summary";

const dummySummary = {
  window: { startDate: "2026-01-01", endDate: "2026-01-04" },
  metrics: [],
  narrative: WHOOP_NARRATIVE,
};

let receivedAuditTool: string | undefined;
const appended: AppendInput[] = [];

const okDeps = {
  resolveActorId: async () => "local",
  findAppUserId: async () => USER_ID,
  getLatestOuraSummary: async () => dummySummary,
  getLatestWhoopSummary: async () => dummySummary,
  getLatestGoogleHealthSummary: async () => dummySummary,
  getLatestVitronicSummary: async (
    _userId: string,
    opts?: { readonly auditTool?: string },
  ) => {
    receivedAuditTool = opts?.auditTool;
    return dummySummary;
  },
  auditPersonalRead: auditPersonalRead(async (input) => {
    appended.push(input);
    return undefined;
  }),
};

describe("GET /api/wearables/summary", () => {
  test("append failure returns generic 502 without a partial summary", async () => {
    receivedAuditTool = undefined;
    const GET = createWearablesSummaryHandler({
      ...okDeps,
      getLatestVitronicSummary: async (
        _userId: string,
        opts?: { readonly auditTool?: string },
      ) => {
        receivedAuditTool = opts?.auditTool;
        throw new Error("audit-down");
      },
    });
    const res = await GET();
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body).toEqual({ error: "Could not load wearable summaries." });
    const blob = JSON.stringify(body);
    expect(blob).not.toContain("audit-down");
    expect(blob.toLowerCase()).not.toContain("prisma");
    expect(blob).not.toContain(WHOOP_NARRATIVE);
    expect(receivedAuditTool).toBe(WEARABLES_SUMMARY_AUDIT_TOOL);
  });

  test("returns all four summaries", async () => {
    receivedAuditTool = undefined;
    appended.length = 0;
    const GET = createWearablesSummaryHandler(okDeps);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      oura: dummySummary,
      whoop: dummySummary,
      googleHealth: dummySummary,
      vitronic: dummySummary,
    });
    expect(receivedAuditTool).toBe(WEARABLES_SUMMARY_AUDIT_TOOL);
  });

  test("writes one personal read row: how many of Oura, Whoop and Google Health had one", async () => {
    appended.length = 0;
    const GET = createWearablesSummaryHandler({
      ...okDeps,
      getLatestWhoopSummary: async () => null,
    });
    expect((await GET()).status).toBe(200);
    expect(appended).toEqual([
      personalReadEvent({ actor: "local", purpose: "wearables-summary", rowCount: 2 }),
    ]);
    expect(JSON.stringify(appended)).not.toContain(WHOOP_NARRATIVE);
  });

  test("signed out reads nothing and writes no row", async () => {
    appended.length = 0;
    const GET = createWearablesSummaryHandler({
      ...okDeps,
      resolveActorId: async () => null,
    });
    expect(await (await GET()).json()).toEqual({
      oura: null,
      whoop: null,
      googleHealth: null,
      vitronic: null,
    });
    expect(appended).toEqual([]);
  });

  test("when the personal read row cannot be written, no summary goes out", async () => {
    const GET = createWearablesSummaryHandler({
      ...okDeps,
      auditPersonalRead: auditPersonalRead(async () => {
        throw new Error("audit-down");
      }),
    });
    const res = await GET();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Could not load wearable summaries." });
  });
});
