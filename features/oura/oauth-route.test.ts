import { describe, expect, test } from "bun:test";

import {
  createOuraAuthorizeHandler,
  createOuraCallbackHandler,
  type OuraAuthorizeDeps,
  type OuraCallbackDeps,
  type OuraCookieJar,
} from "./oauth-handlers";
import { OURA_OAUTH_STATE_COOKIE } from "./oauth-cookie";

const USER_ID = "user-synthetic-1";
const SYNTHETIC_CODE = "synthetic-oura-code";
const MATCH_STATE = "abcd1234";
const OTHER_STATE = "ffffffff";

const OURA_CONFIG = {
  clientId: "synthetic-oura-client",
  clientSecret: "synthetic-oura-secret",
  redirectUri: "http://localhost:8787/callback",
  scopes: ["email", "personal", "daily"] as const,
};

type CookieEntry = {
  value: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
  maxAge?: number;
  path?: string;
};

const jar: OuraCookieJar & { store: Map<string, CookieEntry> } = {
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

let exchangeCalls = 0;
let logged: Array<readonly [string, string]> = [];
let warned: Array<readonly [string, Readonly<Record<string, boolean>>]> = [];
const SYNTHETIC_SECRET = "synthetic-secret-token-body";

const authorizeDeps = (): OuraAuthorizeDeps => ({
  resolveActorId: async () => "local",
  ensureAppUser: async () => ({ id: USER_ID }),
  ouraAppConfig: () => OURA_CONFIG,
  readCookies: async () => jar,
  logError: (message, errorName) => {
    logged.push([message, errorName]);
  },
});

const callbackDeps = (): OuraCallbackDeps => ({
  ouraEnv: () => ({ configured: true }),
  resolveActorId: async () => "local",
  ensureAppUser: async () => ({ id: USER_ID }),
  readCookies: async () => jar,
  createTokenHandlerFromCode: async () => {
    exchangeCalls += 1;
    return {
      lastTokens: () => ({
        access_token: "synthetic-access",
        refresh_token: "synthetic-refresh",
        expires_in: 3600,
      }),
    };
  },
  persistOuraTokens: async () => {},
  syncOuraForUser: async () => ({ synced: { metrics: [] }, save: async () => undefined }),
  auditPersonalRead: async () => undefined,
  recordDisclosure: async () => ({ seq: 1n, auditSeq: 1n }),
  mayReadPersonal: () => true,
  logError: (message, errorName) => {
    logged.push([message, errorName]);
  },
  logWarn: (message, details) => {
    warned.push([message, details]);
  },
});

const authorizeRequest = () => new Request("http://localhost:3000/api/oura/authorize");

const returnTo = (res: Response) => {
  const location = new URL(res.headers.get("location") ?? "");
  return `${location.pathname}${location.search}`;
};

const callbackRequest = (query: string) =>
  new Request(`http://localhost:3000/api/oura/callback?${query}`);

describe("GET /api/oura/authorize", () => {
  test("sets the CSRF cookie and the redirect URL carries the same state", async () => {
    jar.store.clear();
    const res = await createOuraAuthorizeHandler(authorizeDeps())(authorizeRequest());
    expect(res.status).toBe(307);

    const location = res.headers.get("location");
    expect(location).toBeTruthy();
    const redirect = new URL(location ?? "");
    const urlState = redirect.searchParams.get("state");
    const cookie = jar.store.get(OURA_OAUTH_STATE_COOKIE);

    expect(urlState).toBeTruthy();
    expect(urlState).toHaveLength(8);
    expect(cookie?.value).toBe(urlState);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.path).toBe("/");
    expect(cookie?.maxAge).toBe(600);
    expect(cookie?.secure).toBe(false);
  });
});

describe("GET /api/oura/callback", () => {
  test("matching state proceeds to the mocked exchange exactly once and clears the cookie", async () => {
    jar.store.clear();
    exchangeCalls = 0;
    jar.set(OURA_OAUTH_STATE_COOKIE, MATCH_STATE, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });

    const res = await createOuraCallbackHandler(callbackDeps())(
      callbackRequest(`code=${SYNTHETIC_CODE}&state=${MATCH_STATE}`),
    );

    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location") ?? "").searchParams.get("oura")).toBe(
      "connected",
    );
    expect(exchangeCalls).toBe(1);
    expect(jar.store.has(OURA_OAUTH_STATE_COOKIE)).toBe(false);
  });

  test("the code exchange and the first sync are in the disclosure ledger first (#140)", async () => {
    jar.store.clear();
    exchangeCalls = 0;
    jar.set(OURA_OAUTH_STATE_COOKIE, MATCH_STATE, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });
    const order: string[] = [];
    const res = await createOuraCallbackHandler({
      ...callbackDeps(),
      recordDisclosure: async (disclosure) => {
        order.push(`ledger ${disclosure.kind}`);
        return { seq: 1n, auditSeq: 1n };
      },
      createTokenHandlerFromCode: async () => {
        order.push("exchange");
        return { lastTokens: () => null };
      },
    })(callbackRequest(`code=${SYNTHETIC_CODE}&state=${MATCH_STATE}`));
    expect(order).toEqual(["ledger vendor-auth", "exchange"]);
    expect(new URL(res.headers.get("location") ?? "").searchParams.get("oura")).toBe(
      "error",
    );
  });

  test("when the ledger cannot be written the code is never exchanged", async () => {
    jar.store.clear();
    exchangeCalls = 0;
    jar.set(OURA_OAUTH_STATE_COOKIE, MATCH_STATE, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });
    const res = await createOuraCallbackHandler({
      ...callbackDeps(),
      recordDisclosure: async () => {
        throw new Error("ledger down");
      },
    })(callbackRequest(`code=${SYNTHETIC_CODE}&state=${MATCH_STATE}`));
    expect(exchangeCalls).toBe(0);
    expect(new URL(res.headers.get("location") ?? "").searchParams.get("oura")).toBe(
      "error",
    );
  });

  const seedCookie = () => {
    jar.store.clear();
    exchangeCalls = 0;
    warned = [];
    jar.set(OURA_OAUTH_STATE_COOKIE, MATCH_STATE, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });
  };

  test("missing state returns to expired and never calls the exchange", async () => {
    seedCookie();
    const res = await createOuraCallbackHandler(callbackDeps())(
      callbackRequest(`code=${SYNTHETIC_CODE}`),
    );

    expect(res.status).toBe(307);
    expect(returnTo(res)).toBe("/connectors?oura=expired");
    expect(exchangeCalls).toBe(0);
    expect(jar.store.has(OURA_OAUTH_STATE_COOKIE)).toBe(false);
    expect(warned).toEqual([
      ["[oura] callback state mismatch", { hasState: false, hasCookie: true }],
    ]);
  });

  test("mismatched state returns to expired and never calls the exchange", async () => {
    seedCookie();
    const res = await createOuraCallbackHandler(callbackDeps())(
      callbackRequest(`code=${SYNTHETIC_CODE}&state=${OTHER_STATE}`),
    );

    expect(returnTo(res)).toBe("/connectors?oura=expired");
    expect(exchangeCalls).toBe(0);
    expect(jar.store.has(OURA_OAUTH_STATE_COOKIE)).toBe(false);
    expect(warned).toEqual([
      ["[oura] callback state mismatch", { hasState: true, hasCookie: true }],
    ]);
  });

  test("a mismatch carries and logs no code, state or cookie value", async () => {
    seedCookie();
    const res = await createOuraCallbackHandler(callbackDeps())(
      callbackRequest(`code=${SYNTHETIC_CODE}&state=${OTHER_STATE}`),
    );
    const exposed = `${res.headers.get("location")} ${await res.text()} ${JSON.stringify(warned)}`;

    expect(exposed).not.toContain(SYNTHETIC_CODE);
    expect(exposed).not.toContain(MATCH_STATE);
    expect(exposed).not.toContain(OTHER_STATE);
    expect(exposed).not.toContain(OURA_OAUTH_STATE_COOKIE);
  });
});

describe("GET /api/oura/authorize exits", () => {
  test("no actor returns to signin", async () => {
    const res = await createOuraAuthorizeHandler({
      ...authorizeDeps(),
      resolveActorId: async () => null,
    })(authorizeRequest());
    expect(returnTo(res)).toBe("/connectors?oura=signin");
  });

  test("missing config returns to unconfigured and sets no cookie", async () => {
    jar.store.clear();
    const res = await createOuraAuthorizeHandler({
      ...authorizeDeps(),
      ouraAppConfig: () => null,
    })(authorizeRequest());
    expect(returnTo(res)).toBe("/connectors?oura=unconfigured");
    expect(jar.store.has(OURA_OAUTH_STATE_COOKIE)).toBe(false);
  });

  test("a failing user row returns to error and logs the error name only", async () => {
    logged = [];
    const res = await createOuraAuthorizeHandler({
      ...authorizeDeps(),
      ensureAppUser: async () => {
        throw new TypeError(SYNTHETIC_SECRET);
      },
    })(authorizeRequest());
    expect(returnTo(res)).toBe("/connectors?oura=error");
    expect(logged).toEqual([["[oura] authorize failed", "TypeError"]]);
  });
});

describe("GET /api/oura/callback logging", () => {
  const seedState = () => {
    jar.store.clear();
    logged = [];
    jar.set(OURA_OAUTH_STATE_COOKIE, MATCH_STATE, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });
  };

  test("a failing token exchange logs the error name only", async () => {
    seedState();
    const res = await createOuraCallbackHandler({
      ...callbackDeps(),
      createTokenHandlerFromCode: async () => {
        throw new Error(SYNTHETIC_SECRET);
      },
    })(callbackRequest(`code=${SYNTHETIC_CODE}&state=${MATCH_STATE}`));

    expect(new URL(res.headers.get("location") ?? "").searchParams.get("oura")).toBe(
      "error",
    );
    expect(logged).toEqual([["[oura] OAuth callback failed", "Error"]]);
    expect(JSON.stringify(logged)).not.toContain(SYNTHETIC_SECRET);
  });

  test("a failing initial sync logs the error name only", async () => {
    seedState();
    const res = await createOuraCallbackHandler({
      ...callbackDeps(),
      syncOuraForUser: async () => {
        throw new TypeError(SYNTHETIC_SECRET);
      },
    })(callbackRequest(`code=${SYNTHETIC_CODE}&state=${MATCH_STATE}`));

    expect(new URL(res.headers.get("location") ?? "").searchParams.get("oura")).toBe(
      "connected",
    );
    expect(logged).toEqual([["[oura] initial sync failed after connect", "TypeError"]]);
    expect(JSON.stringify(logged)).not.toContain(SYNTHETIC_SECRET);
  });
});

describe("Oura state cookie parity", () => {
  test("a non-localhost redirect sets a secure state cookie", async () => {
    jar.store.clear();
    const res = await createOuraAuthorizeHandler({
      ...authorizeDeps(),
      ouraAppConfig: () => ({
        ...OURA_CONFIG,
        redirectUri: "https://twinllm.example.invalid/api/oura/callback",
      }),
    })(authorizeRequest());
    expect(res.status).toBe(307);
    expect(jar.store.get(OURA_OAUTH_STATE_COOKIE)?.secure).toBe(true);
  });

  test("unconfigured exit clears the cookie", async () => {
    jar.store.clear();
    exchangeCalls = 0;
    jar.store.set(OURA_OAUTH_STATE_COOKIE, { value: MATCH_STATE });
    const res = await createOuraCallbackHandler({
      ...callbackDeps(),
      ouraEnv: () => null,
    })(callbackRequest(`code=${SYNTHETIC_CODE}&state=${MATCH_STATE}`));
    expect(new URL(res.headers.get("location") ?? "").searchParams.get("oura")).toBe(
      "unconfigured",
    );
    expect(exchangeCalls).toBe(0);
    expect(jar.store.has(OURA_OAUTH_STATE_COOKIE)).toBe(false);
  });

  test("signin exit clears the cookie", async () => {
    jar.store.clear();
    exchangeCalls = 0;
    jar.store.set(OURA_OAUTH_STATE_COOKIE, { value: MATCH_STATE });
    const res = await createOuraCallbackHandler({
      ...callbackDeps(),
      resolveActorId: async () => null,
    })(callbackRequest(`code=${SYNTHETIC_CODE}&state=${MATCH_STATE}`));
    expect(new URL(res.headers.get("location") ?? "").searchParams.get("oura")).toBe(
      "signin",
    );
    expect(exchangeCalls).toBe(0);
    expect(jar.store.has(OURA_OAUTH_STATE_COOKIE)).toBe(false);
  });
});
