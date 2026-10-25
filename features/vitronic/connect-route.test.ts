import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { createVitronicConnectHandler as CreateConnectHandler } from "./connect-handler";
import type { persistVitronicConnection as PersistConnection } from "./connection";

/**
 * The scanner URL is refused before first contact: capturePin (the only network
 * step before the database write) must never run for a refused URL.
 */

const originalEnv = { ...process.env };
let createVitronicConnectHandler: typeof CreateConnectHandler;
let persistVitronicConnection: typeof PersistConnection;

beforeAll(async () => {
  Object.assign(process.env, {
    LOCAL_MVP: "true",
    AUTH_DISABLED: "true",
    LLM_PROVIDER: "ollama",
    DATA_MODE: "synthetic",
    DATABASE_URL: "postgresql://synthetic@localhost:1/none",
    VITRONIC_TOKEN_ENCRYPTION_KEY: "0".repeat(64),
  });
  const { resetServerEnvCacheForTests } = await import("@/infrastructure/env");
  resetServerEnvCacheForTests();
  ({ createVitronicConnectHandler } = await import("./connect-handler"));
  ({ persistVitronicConnection } = await import("./connection"));
});

afterAll(async () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) Reflect.deleteProperty(process.env, key);
  }
  Object.assign(process.env, originalEnv);
  const { resetServerEnvCacheForTests } = await import("@/infrastructure/env");
  resetServerEnvCacheForTests();
});

const post = (baseUrl: string) =>
  new Request("http://local/api/vitronic/connect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      baseUrl,
      apiToken: "synthetic-token",
      probandId: 3,
      uploadSecret: "synthetic-secret",
    }),
  });

const handlerRecordingPins = (pinned: string[]) =>
  createVitronicConnectHandler({
    vitronicEnv: () => ({ encryptionKey: "synthetic", dataDir: null }),
    resolveActorId: async () => "local",
    ensureAppUser: async () => ({ id: "user-synthetic-1" }),
    persistVitronicConnection: (params) =>
      persistVitronicConnection({
        ...params,
        capturePin: async ({ baseUrl }) => {
          pinned.push(baseUrl);
          throw new Error("synthetic: stop before the database");
        },
      }),
  });

describe("POST /api/vitronic/connect scanner URL checks", () => {
  test("refused URLs answer 400 and never reach the scanner", async () => {
    const pinned: string[] = [];
    const POST = handlerRecordingPins(pinned);
    for (const baseUrl of [
      "http://192.168.1.20",
      "https://op:pw@192.168.1.20",
      "https://192.168.1.20/admin?x=1#",
      "https://192.168.1.20:22",
      "https://169.254.169.254",
      "https://127.0.0.1:8443",
    ]) {
      const res = await POST(post(baseUrl));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error:
          "Use the scanner's https address only, such as https://192.168.1.20, with no path or sign-in details.",
      });
    }
    expect(pinned).toEqual([]);
  });

  test("an accepted URL is reduced to its origin before first contact", async () => {
    const pinned: string[] = [];
    const res = await handlerRecordingPins(pinned)(post("https://192.168.1.20:8443/"));
    expect(res.status).toBe(502);
    expect(pinned).toEqual(["https://192.168.1.20:8443"]);
  });
});
