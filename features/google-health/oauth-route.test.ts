import { beforeEach, describe, expect, test } from "bun:test";

import { GOOGLE_HEALTH_OAUTH_STATE_COOKIE } from "./oauth-cookie";
import {
  createGoogleHealthAuthorizeHandler,
  createGoogleHealthCallbackHandler,
  type GoogleHealthAuthorizeDeps,
  type GoogleHealthCallbackDeps,
} from "./oauth-handlers";
import {
  type OAuthCookieJar,
  type OAuthCookieSetOptions,
} from "@/infrastructure/oauth-state";

const USER_ID = "user-synthetic-1";
const SYNTHETIC_CODE = "synthetic-google-health-code";
const MATCH_STATE = "abcd1234";
const OTHER_STATE = "ffffffff";
const SYNTHETIC_SECRET = "synthetic-secret-token-body";

type CookieEntry = { value: string } & Partial<OAuthCookieSetOptions>;

const store = new Map<string, CookieEntry>();
const jar: OAuthCookieJar = {
  set: (name, value, options) => {
    store.set(name, { value, ...options });
  },
  get: (name) => {
    const row = store.get(name);
    return row ? { value: row.value } : undefined;
  },
  delete: (name) => {
    store.delete(name);
  },
};

let exchangeCalls = 0;
let logged: Array<readonly [string, string]> = [];
let warned: Array<readonly [string, Readonly<Record<string, unknown>>]> = [];

const seedCookie = () => {
  store.set(GOOGLE_HEALTH_OAUTH_STATE_COOKIE, { value: MATCH_STATE });
};

const authorizeDeps = (redirectUri: string): GoogleHealthAuthorizeDeps => ({
  resolveActorId: async () => "local",
  ensureAppUser: async () => ({ id: USER_ID }),
  googleHealthAppConfig: () => ({ redirectUri }),
  createState: () => MATCH_STATE,
  buildAuthorizeUrl: () =>
    "https://accounts.example.invalid/o/oauth2/auth?client_id=synthetic",
  readCookies: async () => jar,
  logError: (message, errorName) => {
    logged.push([message, errorName]);
  },
});

const callbackDeps = (): GoogleHealthCallbackDeps => ({
  isConfigured: () => true,
  resolveActorId: async () => "local",
  ensureAppUser: async () => ({ id: USER_ID }),
  readCookies: async () => jar,
  exchangeAndPersistCode: async () => {
    exchangeCalls += 1;
  },
  syncForUser: async () => ({ metrics: [] }),
  auditPersonalRead: async () => undefined,
  logError: (message, errorName) => {
    logged.push([message, errorName]);
  },
  logWarn: (message, details) => {
    warned.push([message, details]);
  },
});

const authorizeRequest = () =>
  new Request("http://localhost:3000/api/google-health/authorize");

const callbackRequest = (query: string) =>
  new Request(`http://localhost:3000/api/google-health/callback?${query}`);

const googleHealthParam = (res: Response) =>
  new URL(res.headers.get("location") ?? "").searchParams.get("google-health");

beforeEach(() => {
  store.clear();
  exchangeCalls = 0;
  logged = [];
  warned = [];
});

describe("GET /api/google-health/authorize", () => {
  test("a localhost redirect sets a non-secure state cookie", async () => {
    const res = await createGoogleHealthAuthorizeHandler(
      authorizeDeps("http://localhost:3000/api/google-health/callback"),
    )(authorizeRequest());
    expect(res.status).toBe(307);
    expect(store.get(GOOGLE_HEALTH_OAUTH_STATE_COOKIE)).toEqual({
      value: MATCH_STATE,
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });
  });

  test("a non-localhost redirect sets a secure state cookie", async () => {
    const res = await createGoogleHealthAuthorizeHandler(
      authorizeDeps("https://twinllm.example.invalid/api/google-health/callback"),
    )(authorizeRequest());
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      `https://accounts.example.invalid/o/oauth2/auth?client_id=synthetic&state=${MATCH_STATE}`,
    );
    expect(store.get(GOOGLE_HEALTH_OAUTH_STATE_COOKIE)?.secure).toBe(true);
  });
});

describe("GET /api/google-health/callback", () => {
  test("matching state exchanges once, redirects connected and clears the cookie", async () => {
    seedCookie();
    const res = await createGoogleHealthCallbackHandler(callbackDeps())(
      callbackRequest(`code=${SYNTHETIC_CODE}&state=${MATCH_STATE}`),
    );
    expect(res.status).toBe(307);
    expect(googleHealthParam(res)).toBe("connected");
    expect(exchangeCalls).toBe(1);
    expect(store.has(GOOGLE_HEALTH_OAUTH_STATE_COOKIE)).toBe(false);
  });

  test("missing state returns to expired and never exchanges", async () => {
    seedCookie();
    const res = await createGoogleHealthCallbackHandler(callbackDeps())(
      callbackRequest(`code=${SYNTHETIC_CODE}`),
    );
    expect(res.status).toBe(307);
    expect(googleHealthParam(res)).toBe("expired");
    expect(exchangeCalls).toBe(0);
    expect(store.has(GOOGLE_HEALTH_OAUTH_STATE_COOKIE)).toBe(false);
    expect(warned).toEqual([
      ["[google-health] callback state mismatch", { hasState: false, hasCookie: true }],
    ]);
  });

  test("mismatched state returns to expired and never exchanges", async () => {
    seedCookie();
    const res = await createGoogleHealthCallbackHandler(callbackDeps())(
      callbackRequest(`code=${SYNTHETIC_CODE}&state=${OTHER_STATE}`),
    );
    expect(googleHealthParam(res)).toBe("expired");
    expect(exchangeCalls).toBe(0);
    expect(store.has(GOOGLE_HEALTH_OAUTH_STATE_COOKIE)).toBe(false);
    expect(warned).toEqual([
      ["[google-health] callback state mismatch", { hasState: true, hasCookie: true }],
    ]);
    expect(JSON.stringify(warned)).not.toContain(OTHER_STATE);
    expect(JSON.stringify(warned)).not.toContain(MATCH_STATE);
  });

  test("missing cookie returns to expired and never exchanges", async () => {
    const res = await createGoogleHealthCallbackHandler(callbackDeps())(
      callbackRequest(`code=${SYNTHETIC_CODE}&state=${MATCH_STATE}`),
    );
    expect(googleHealthParam(res)).toBe("expired");
    expect(exchangeCalls).toBe(0);
    expect(warned).toEqual([
      ["[google-health] callback state mismatch", { hasState: true, hasCookie: false }],
    ]);
  });

  test("a provider error redirects denied and never exchanges", async () => {
    seedCookie();
    const warned: Array<readonly [string, Readonly<Record<string, unknown>>]> = [];
    const res = await createGoogleHealthCallbackHandler({
      ...callbackDeps(),
      logWarn: (message, details) => {
        warned.push([message, details]);
      },
    })(callbackRequest(`error=access_denied&state=${MATCH_STATE}`));
    expect(googleHealthParam(res)).toBe("denied");
    expect(exchangeCalls).toBe(0);
    expect(store.has(GOOGLE_HEALTH_OAUTH_STATE_COOKIE)).toBe(false);
    expect(warned).toEqual([
      ["[google-health] callback rejected", { hasOauthError: true, hasCode: false }],
    ]);
  });

  test("unconfigured exit clears the cookie", async () => {
    seedCookie();
    const res = await createGoogleHealthCallbackHandler({
      ...callbackDeps(),
      isConfigured: () => false,
    })(callbackRequest(`code=${SYNTHETIC_CODE}&state=${MATCH_STATE}`));
    expect(googleHealthParam(res)).toBe("unconfigured");
    expect(exchangeCalls).toBe(0);
    expect(store.has(GOOGLE_HEALTH_OAUTH_STATE_COOKIE)).toBe(false);
  });

  test("signin exit clears the cookie", async () => {
    seedCookie();
    const res = await createGoogleHealthCallbackHandler({
      ...callbackDeps(),
      resolveActorId: async () => null,
    })(callbackRequest(`code=${SYNTHETIC_CODE}&state=${MATCH_STATE}`));
    expect(googleHealthParam(res)).toBe("signin");
    expect(exchangeCalls).toBe(0);
    expect(store.has(GOOGLE_HEALTH_OAUTH_STATE_COOKIE)).toBe(false);
  });

  test("a failing exchange logs the error name only", async () => {
    seedCookie();
    const res = await createGoogleHealthCallbackHandler({
      ...callbackDeps(),
      exchangeAndPersistCode: async () => {
        throw new Error(SYNTHETIC_SECRET);
      },
    })(callbackRequest(`code=${SYNTHETIC_CODE}&state=${MATCH_STATE}`));
    expect(googleHealthParam(res)).toBe("error");
    expect(logged).toEqual([["[google-health] OAuth callback failed", "Error"]]);
  });

  test("a failing initial sync logs the error name only", async () => {
    seedCookie();
    const res = await createGoogleHealthCallbackHandler({
      ...callbackDeps(),
      syncForUser: async () => {
        throw new TypeError(SYNTHETIC_SECRET);
      },
    })(callbackRequest(`code=${SYNTHETIC_CODE}&state=${MATCH_STATE}`));
    expect(googleHealthParam(res)).toBe("connected");
    expect(logged).toEqual([
      ["[google-health] initial sync failed after connect", "TypeError"],
    ]);
  });
});

describe("GET /api/google-health/authorize exits", () => {
  test("no actor returns to signin", async () => {
    const res = await createGoogleHealthAuthorizeHandler({
      ...authorizeDeps("http://localhost:3000/api/google-health/callback"),
      resolveActorId: async () => null,
    })(authorizeRequest());
    expect(googleHealthParam(res)).toBe("signin");
  });

  test("missing config returns to unconfigured and sets no cookie", async () => {
    const res = await createGoogleHealthAuthorizeHandler({
      ...authorizeDeps("http://localhost:3000/api/google-health/callback"),
      googleHealthAppConfig: () => null,
    })(authorizeRequest());
    expect(googleHealthParam(res)).toBe("unconfigured");
    expect(store.has(GOOGLE_HEALTH_OAUTH_STATE_COOKIE)).toBe(false);
  });

  test("a failing user row returns to error and logs the error name only", async () => {
    const res = await createGoogleHealthAuthorizeHandler({
      ...authorizeDeps("http://localhost:3000/api/google-health/callback"),
      ensureAppUser: async () => {
        throw new TypeError(SYNTHETIC_SECRET);
      },
    })(authorizeRequest());
    expect(googleHealthParam(res)).toBe("error");
    expect(logged).toEqual([["[google-health] authorize failed", "TypeError"]]);
  });
});
