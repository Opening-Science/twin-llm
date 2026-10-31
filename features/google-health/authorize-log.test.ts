import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";

import { moduleMocker } from "@/tests/support/mock-module";

const USER_ID = "user-synthetic-1";

type CookieEntry = {
  value: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
  maxAge?: number;
  path?: string;
};

const jar = {
  store: new Map<string, CookieEntry>(),
  set(name: string, value: string, options?: Omit<CookieEntry, "value">) {
    jar.store.set(name, { value, ...options });
  },
  get(name: string) {
    const row = jar.store.get(name);
    return row ? { name, value: row.value } : undefined;
  },
  delete(name: string) {
    jar.store.delete(name);
  },
};

const originalEnv = { ...process.env };

const mockModuleForFile = moduleMocker({ mock, afterAll });
mock.module("server-only", () => ({}));
await mockModuleForFile("next/headers", {
  cookies: async () => jar,
});
await mockModuleForFile("@/infrastructure/auth-actor", {
  resolveActorId: async () => "local",
});
await mockModuleForFile("@/infrastructure/current-user", {
  findAppUserId: async () => USER_ID,
  ensureAppUser: async () => ({ id: USER_ID }),
});

let authorizeGET: () => Promise<Response>;

beforeAll(async () => {
  Object.assign(process.env, {
    LOCAL_MVP: "true",
    AUTH_DISABLED: "true",
    LLM_PROVIDER: "ollama",
    DATA_MODE: "synthetic",
    DATABASE_URL: "postgresql://synthetic@localhost:1/none",
    GOOGLE_HEALTH_CLIENT_ID: "synthetic-google-health-client",
    GOOGLE_HEALTH_CLIENT_SECRET: "synthetic-google-health-secret",
    GOOGLE_HEALTH_REDIRECT_URI: "http://localhost:3000/api/google-health/callback",
    GOOGLE_HEALTH_TOKEN_ENCRYPTION_KEY: "0".repeat(64),
  });
  const { resetServerEnvCacheForTests } = await import("@/infrastructure/env");
  resetServerEnvCacheForTests();
  ({ GET: authorizeGET } = await import("@/app/api/google-health/authorize/route"));
});

afterAll(async () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) Reflect.deleteProperty(process.env, key);
  }
  Object.assign(process.env, originalEnv);
  const { resetServerEnvCacheForTests } = await import("@/infrastructure/env");
  resetServerEnvCacheForTests();
});

beforeEach(() => {
  jar.store.clear();
});

describe("GET /api/google-health/authorize", () => {
  test("console output does not contain redirect_uri", async () => {
    const lines: string[] = [];
    const errorSpy = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
    const logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });

    const res = await authorizeGET();
    expect(res.status).toBe(307);

    const joined = lines.join("\n");
    expect(joined).not.toContain("redirect_uri");

    errorSpy.mockRestore();
    logSpy.mockRestore();
  });
});
