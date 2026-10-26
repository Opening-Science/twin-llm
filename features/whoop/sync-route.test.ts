import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

import {
  SYNTHETIC_WHOOP_PAYLOAD,
  SYNTHETIC_WINDOW,
} from "./fixtures/synthetic-sync-payload";
import { buildWhoopSummary } from "./summary";

const WHOOP_API = "https://api.prod.whoop.com/developer/v2";
const USER_ID = "user-synthetic-1";

type CreateArgs = { data: Record<string, unknown> };
type UpdateArgs = { where: { userId: string }; data: Record<string, unknown> };
type FindFirstArgs = {
  where: { userId: string };
  orderBy: Record<string, string>;
  select?: Record<string, boolean>;
};

const STORED_SUMMARY = buildWhoopSummary(SYNTHETIC_WHOOP_PAYLOAD, SYNTHETIC_WINDOW);
const STORED_SNAPSHOT: Record<string, unknown> = {
  id: "snapshot-synthetic-1",
  userId: USER_ID,
  startDate: SYNTHETIC_WINDOW.startDate,
  endDate: SYNTHETIC_WINDOW.endDate,
  summary: STORED_SUMMARY,
  fhirBundle: { resourceType: "Bundle", type: "collection", entry: [] },
  syncedAt: new Date("2026-01-05T00:00:00Z"),
};

const recorded = {
  snapshots: [] as CreateArgs[],
  connectionUpdates: [] as UpdateArgs[],
  snapshotQueries: [] as FindFirstArgs[],
  snapshotRows: [] as Record<string, unknown>[],
};

let connectionRow: Record<string, unknown> | null = null;

mock.module("server-only", () => ({}));
mock.module("@/infrastructure/auth-actor", () => ({
  resolveActorId: async () => "local",
}));
mock.module("@/infrastructure/database", () => ({
  database: () => ({
    user: { findUnique: async () => ({ id: USER_ID }) },
    whoopConnection: {
      findUnique: async () => connectionRow,
      update: async (args: UpdateArgs) => {
        recorded.connectionUpdates.push(args);
        return {};
      },
    },
    whoopSnapshot: {
      create: async (args: CreateArgs) => {
        recorded.snapshots.push(args);
        return {};
      },
      findFirst: async (args: FindFirstArgs) => {
        recorded.snapshotQueries.push(args);
        const { select } = args;
        const row = select
          ? Object.fromEntries(
              Object.entries(STORED_SNAPSHOT).filter(([field]) => select[field] === true),
            )
          : { ...STORED_SNAPSHOT };
        recorded.snapshotRows.push(row);
        return row;
      },
    },
  }),
}));

type Collection = "recovery" | "cycle" | "sleep" | "workout";
let responses: Record<Collection, { status: number; records: unknown[] }>;

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

const collectionFor = (url: URL): Collection | null => {
  if (url.href.startsWith(`${WHOOP_API}/recovery`)) return "recovery";
  if (url.href.startsWith(`${WHOOP_API}/cycle`)) return "cycle";
  if (url.href.startsWith(`${WHOOP_API}/activity/sleep`)) return "sleep";
  if (url.href.startsWith(`${WHOOP_API}/activity/workout`)) return "workout";
  return null;
};

let POST: (request: Request) => Promise<Response>;

beforeAll(async () => {
  Object.assign(process.env, {
    LOCAL_MVP: "true",
    AUTH_DISABLED: "true",
    LLM_PROVIDER: "ollama",
    DATA_MODE: "synthetic",
    DATABASE_URL: "postgresql://synthetic@localhost:1/none",
    WHOOP_CLIENT_ID: "synthetic-client",
    WHOOP_CLIENT_SECRET: "synthetic-client-secret",
    WHOOP_REDIRECT_URI: "https://localhost:8788/api/whoop/callback",
    WHOOP_TOKEN_ENCRYPTION_KEY: "0".repeat(64),
  });

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url =
      input instanceof URL
        ? input
        : new URL(input instanceof Request ? input.url : input);
    const collection = collectionFor(url);
    if (!collection) return new Response(null, { status: 404 });
    const { status, records } = responses[collection];
    if (status !== 200) return new Response(null, { status });
    return new Response(JSON.stringify({ records, next_token: null }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  const { encryptWhoopSecret } = await import("./token-crypto");
  connectionRow = {
    userId: USER_ID,
    accessTokenEnc: encryptWhoopSecret("synthetic-access"),
    refreshTokenEnc: encryptWhoopSecret("synthetic-refresh"),
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
  };

  ({ POST } = await import("@/app/api/whoop/sync/route"));
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) Reflect.deleteProperty(process.env, key);
  }
  Object.assign(process.env, originalEnv);
});

beforeEach(() => {
  recorded.snapshots.length = 0;
  recorded.connectionUpdates.length = 0;
  recorded.snapshotQueries.length = 0;
  recorded.snapshotRows.length = 0;
});

const syncRequest = () =>
  new Request("http://localhost:3000/api/whoop/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ startDate: "2026-01-01", endDate: "2026-01-04" }),
  });

describe("POST /api/whoop/sync error surface", () => {
  test("every collection failing returns the generic 502 and persists nothing", async () => {
    responses = {
      recovery: { status: 500, records: [] },
      cycle: { status: 500, records: [] },
      sleep: { status: 500, records: [] },
      workout: { status: 500, records: [] },
    };

    const res = await POST(syncRequest());

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: "Could not sync Whoop data. Reconnect and try again.",
    });
    expect(recorded.snapshots).toEqual([]);
    expect(recorded.connectionUpdates).toEqual([]);
  });

  test("one failed collection keeps the partial summary and persists it", async () => {
    responses = {
      recovery: { status: 500, records: [] },
      cycle: { status: 200, records: SYNTHETIC_WHOOP_PAYLOAD.cycles },
      sleep: { status: 200, records: SYNTHETIC_WHOOP_PAYLOAD.sleep },
      workout: { status: 500, records: [] },
    };

    const res = await POST(syncRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      metricCount: 6,
      window: { startDate: "2026-01-01", endDate: "2026-01-04" },
    });

    expect(recorded.connectionUpdates).toHaveLength(1);
    expect(recorded.connectionUpdates[0]?.where).toEqual({ userId: USER_ID });

    expect(recorded.snapshots).toHaveLength(1);
    const data = recorded.snapshots[0]?.data ?? {};
    expect(data.userId).toBe(USER_ID);
    expect(data.startDate).toBe("2026-01-01");
    expect(data.endDate).toBe("2026-01-04");

    const summary = data.summary as {
      window: unknown;
      metrics: { key: string; value: number; unit?: string }[];
      narrative: string;
    };
    expect(summary.window).toEqual({ startDate: "2026-01-01", endDate: "2026-01-04" });
    expect(summary.metrics.map((m) => [m.key, m.value, m.unit ?? null])).toEqual([
      ["whoop.cycle.strain.2026-01-01", 11.5, null],
      ["whoop.cycle.avg_hr.2026-01-01", 71, "bpm"],
      ["whoop.sleep.performance.2026-01-01", 88, "%"],
      ["whoop.sleep.efficiency.2026-01-01", 91.3, "%"],
      ["whoop.sleep.consistency.2026-01-01", 77, "%"],
      ["whoop.sleep.in_bed_min.2026-01-01", 450, "min"],
    ]);
    expect(data.summary).toEqual(
      buildWhoopSummary(
        {
          recovery: [],
          cycles: SYNTHETIC_WHOOP_PAYLOAD.cycles,
          sleep: SYNTHETIC_WHOOP_PAYLOAD.sleep,
          workouts: [],
        },
        { startDate: "2026-01-01", endDate: "2026-01-04" },
      ),
    );
  });

  test("persists the package FHIR bundle plus workouts for the synced rows", async () => {
    responses = {
      recovery: { status: 500, records: [] },
      cycle: { status: 200, records: SYNTHETIC_WHOOP_PAYLOAD.cycles },
      sleep: { status: 200, records: SYNTHETIC_WHOOP_PAYLOAD.sleep },
      workout: { status: 200, records: SYNTHETIC_WHOOP_PAYLOAD.workouts },
    };

    await POST(syncRequest());

    const bundle = recorded.snapshots[0]?.data.fhirBundle as {
      resourceType: string;
      entry: {
        resource: {
          resourceType: string;
          code?: { coding: { system: string; code: string }[] };
        };
      }[];
    };
    expect(bundle.resourceType).toBe("Bundle");
    expect(
      bundle.entry.map((e) =>
        e.resource.resourceType === "Observation"
          ? (e.resource.code?.coding ?? []).map((c) => `${c.system}|${c.code}`).join(",")
          : e.resource.resourceType,
      ),
    ).toEqual([
      "Patient",
      "http://opentwin.ch/fhir/CodeSystem/whoop|day-strain",
      "http://loinc.org|8867-4",
      "http://opentwin.ch/fhir/CodeSystem/whoop|sleep-performance",
      "http://opentwin.ch/fhir/CodeSystem/whoop|sleep-efficiency",
      "http://loinc.org|103213-5",
      "http://opentwin.ch/fhir/CodeSystem/whoop|workout",
      "http://opentwin.ch/fhir/CodeSystem/whoop|workout",
    ]);
  });
});

describe("getLatestWhoopSummary", () => {
  test("reads only the summary column, never the FHIR bundle", async () => {
    const { getLatestWhoopSummary } = await import("./connection");

    const result = await getLatestWhoopSummary(USER_ID);

    expect(recorded.snapshotQueries).toEqual([
      {
        where: { userId: USER_ID },
        orderBy: { syncedAt: "desc" },
        select: { summary: true },
      },
    ]);
    expect(recorded.snapshotRows.map((row) => Object.keys(row))).toEqual([["summary"]]);
    expect(result).toEqual(STORED_SUMMARY);
    expect(Object.keys(result ?? {})).not.toContain("fhirBundle");
  });
});
