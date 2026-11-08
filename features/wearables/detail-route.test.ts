import { describe, expect, test } from "bun:test";

import { buildBundleFromResponses } from "@open-twin/provider-google-health";

import { SYNTHETIC_GOOGLE_HEALTH_RESPONSES } from "@/features/google-health/fixtures/synthetic-sync-responses";
import {
  auditPersonalRead,
  personalReadEvent,
} from "@/infrastructure/personal-read-audit";
import type { AppendInput } from "@/packages/audit/append";

import { createWearablesDetailHandler, type WearablesDetailDeps } from "./detail-handler";
import type { WearableSource } from "./dashboard-headings";

const BUNDLE = buildBundleFromResponses(SYNTHETIC_GOOGLE_HEALTH_RESPONSES, {
  subjectKey: "synthetic-wearer-1",
  timestamp: "2026-01-09T00:00:00Z",
}).bundle;

const URL_OK =
  "http://localhost/api/wearables/detail?source=google-health&start=2026-01-01&end=2026-01-31&tz=Europe/Zurich";

const setup = (over: Partial<WearablesDetailDeps> = {}) => {
  const rows: AppendInput[] = [];
  const reads: [WearableSource, string][] = [];
  const GET = createWearablesDetailHandler({
    resolveActorId: async () => "local",
    findAppUserId: async () => "app-user-synthetic-1",
    getLatestBundle: async (source, userId) => {
      reads.push([source, userId]);
      return BUNDLE;
    },
    auditPersonalRead: auditPersonalRead(async (input) => {
      rows.push(input);
    }),
    ...over,
  });
  return { GET, rows, reads };
};

describe("GET /api/wearables/detail", () => {
  test("sends the three charts for the owner's source and writes one row first", async () => {
    const { GET, rows, reads } = setup();
    const res = await GET(new Request(URL_OK));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { detail: Record<string, { status: string }> };
    expect(Object.keys(body)).toEqual(["detail"]);
    expect(Object.keys(body.detail)).toEqual(["steps", "night", "nights"]);
    expect([body.detail.steps!.status, body.detail.night!.status]).toEqual(["ok", "ok"]);
    expect(reads).toEqual([["google-health", "app-user-synthetic-1"]]);
    expect(rows).toEqual([
      personalReadEvent({ actor: "local", purpose: "wearables-detail", rowCount: 3 }),
    ]);
  });

  test("never sends the bundle, a timestamp, an offset or an id", async () => {
    const { GET } = setup();
    const text = await (await GET(new Request(URL_OK))).text();
    expect(text).not.toMatch(
      /resourceType|Observation|synthetic-wearer|T\d{2}:\d{2}|\+01:00|3600s/,
    );
  });

  test("signed out, or with no app user, reads nothing and writes no row", async () => {
    for (const over of [
      { resolveActorId: async () => null },
      { findAppUserId: async () => null },
    ]) {
      const { GET, rows, reads } = setup(over);
      expect(await (await GET(new Request(URL_OK))).json()).toEqual({ detail: null });
      expect([rows, reads]).toEqual([[], []]);
    }
  });

  test("a bad source or window is refused before anything is read", async () => {
    for (const query of [
      "source=fitbit&start=2026-01-01&end=2026-01-31",
      "source=oura&start=2026-1-1&end=2026-01-31",
      "source=oura&start=2026-02-01&end=2026-01-31",
      "source=oura",
    ]) {
      const { GET, rows, reads } = setup();
      const res = await GET(
        new Request(`http://localhost/api/wearables/detail?${query}`),
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: "Pick a source and a window to load the detail charts.",
      });
      expect([rows, reads]).toEqual([[], []]);
    }
  });

  test("an unknown zone falls back to UTC instead of failing", async () => {
    const { GET } = setup();
    const res = await GET(new Request(URL_OK.replace("Europe/Zurich", "Mars/Olympus")));
    expect(res.status).toBe(200);
  });

  test("a stored value that is not a bundle reads as no detail", async () => {
    const { GET, rows } = setup({ getLatestBundle: async () => ({ hello: "world" }) });
    expect(await (await GET(new Request(URL_OK))).json()).toEqual({
      detail: {
        steps: { status: "missing" },
        night: { status: "missing" },
        nights: { status: "missing" },
      },
    });
    expect(rows.map((row) => row.rowCount)).toEqual([0]);
  });

  test("when the row cannot be written, nothing goes out", async () => {
    const { GET } = setup({
      auditPersonalRead: auditPersonalRead(async () => {
        throw new Error("audit-down");
      }),
    });
    const res = await GET(new Request(URL_OK));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Could not load the detail charts." });
  });

  test("a failed read shows a plain sentence, never the provider's error", async () => {
    const { GET, rows } = setup({
      getLatestBundle: async () => {
        throw new Error("prisma: relation oura_snapshots does not exist");
      },
    });
    const res = await GET(new Request(URL_OK));
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain("prisma");
    expect(rows).toEqual([]);
  });
});
