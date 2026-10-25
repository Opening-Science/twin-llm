import { beforeEach, describe, expect, test } from "bun:test";

import {
  createWearableSyncHandler,
  type WearableSyncDeps,
  type WearableSyncProvider,
  type WearableSyncRequest,
} from "./sync-handler";

const USER_ID = "user-synthetic-1";
const SYNTHETIC_SECRET = "synthetic-secret-token-body";
const WINDOW = { startDate: "2026-01-01", endDate: "2026-01-04" };

const PROVIDERS: ReadonlyArray<
  Readonly<{
    provider: WearableSyncProvider;
    unconfigured: string;
    signIn: string;
    failed: string;
  }>
> = [
  {
    provider: "oura",
    unconfigured: "Oura is not configured.",
    signIn: "Sign in to sync Oura.",
    failed: "Could not sync Oura data. Reconnect and try again.",
  },
  {
    provider: "whoop",
    unconfigured: "Whoop is not configured.",
    signIn: "Sign in to sync Whoop.",
    failed: "Could not sync Whoop data. Reconnect and try again.",
  },
  {
    provider: "google-health",
    unconfigured: "Google Health is not configured.",
    signIn: "Sign in to sync Google Health.",
    failed:
      "Could not sync Google Health. Confirm Fitbit is linked to the Google account and API access is enabled, then reconnect.",
  },
];

let logged: Array<readonly [string, string]> = [];
let syncCalls: Array<readonly [string, WearableSyncRequest]> = [];

const deps = (provider: WearableSyncProvider): WearableSyncDeps => ({
  provider,
  isConfigured: () => true,
  resolveActorId: async () => "local",
  findAppUserId: async () => USER_ID,
  sync: async (userId, request) => {
    syncCalls.push([userId, request]);
    return { metrics: [{ key: "synthetic.metric", value: 1 }], window: WINDOW };
  },
  logError: (message, errorName) => {
    logged.push([message, errorName]);
  },
});

const failingSync =
  (error: unknown): WearableSyncDeps["sync"] =>
  async () => {
    throw error;
  };

const syncRequest = (body?: unknown) =>
  new Request("http://localhost:3000/api/oura/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  logged = [];
  syncCalls = [];
});

describe("POST /api/{provider}/sync logging", () => {
  for (const { provider, failed } of PROVIDERS) {
    test(`${provider} logs the error name only and returns its 502 sentence`, async () => {
      const res = await createWearableSyncHandler({
        ...deps(provider),
        sync: failingSync(new Error(SYNTHETIC_SECRET)),
      })(syncRequest(WINDOW));
      const body: unknown = await res.json();

      expect(res.status).toBe(502);
      expect(body).toEqual({ error: failed });
      expect(logged).toEqual([[`[${provider}] sync failed`, "Error"]]);
      expect(JSON.stringify([logged, body])).not.toContain(SYNTHETIC_SECRET);
    });
  }

  test("an Error subclass logs its own name", async () => {
    await createWearableSyncHandler({
      ...deps("whoop"),
      sync: failingSync(new TypeError(SYNTHETIC_SECRET)),
    })(syncRequest(WINDOW));

    expect(logged).toEqual([["[whoop] sync failed", "TypeError"]]);
  });

  test("a thrown non-Error logs unknown", async () => {
    await createWearableSyncHandler({
      ...deps("google-health"),
      sync: failingSync({ message: SYNTHETIC_SECRET }),
    })(syncRequest(WINDOW));

    expect(logged).toEqual([["[google-health] sync failed", "unknown"]]);
  });
});

describe("POST /api/{provider}/sync", () => {
  test("passes the window and sandbox flag through and returns the metric count", async () => {
    const res = await createWearableSyncHandler(deps("oura"))(
      syncRequest({ ...WINDOW, sandbox: true }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, metricCount: 1, window: WINDOW });
    expect(syncCalls).toEqual([[USER_ID, { sandbox: true, ...WINDOW }]]);
    expect(logged).toEqual([]);
  });

  test("an empty body syncs with no window, so the default applies", async () => {
    const res = await createWearableSyncHandler(deps("whoop"))(syncRequest());

    expect(res.status).toBe(200);
    expect(syncCalls).toEqual([
      [USER_ID, { sandbox: undefined, startDate: undefined, endDate: undefined }],
    ]);
  });

  for (const { provider, unconfigured, signIn } of PROVIDERS) {
    test(`${provider} unconfigured returns 503 and never syncs`, async () => {
      const res = await createWearableSyncHandler({
        ...deps(provider),
        isConfigured: () => false,
      })(syncRequest(WINDOW));

      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: unconfigured });
      expect(syncCalls).toEqual([]);
    });

    test(`${provider} signed out returns 401 and never syncs`, async () => {
      const res = await createWearableSyncHandler({
        ...deps(provider),
        resolveActorId: async () => null,
      })(syncRequest(WINDOW));

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: signIn });
      expect(syncCalls).toEqual([]);
    });
  }

  test("a missing user row returns 400 and never syncs", async () => {
    const res = await createWearableSyncHandler({
      ...deps("oura"),
      findAppUserId: async () => null,
    })(syncRequest(WINDOW));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "User record missing." });
    expect(syncCalls).toEqual([]);
  });
});
