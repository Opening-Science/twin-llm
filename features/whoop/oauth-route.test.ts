import { beforeEach, describe, expect, test } from "bun:test";

import { WHOOP_OAUTH_STATE_COOKIE } from "./oauth-cookie";
import {
  createWhoopAuthorizeHandler,
  createWhoopCallbackHandler,
  type WhoopAuthorizeDeps,
  type WhoopCallbackDeps,
} from "./oauth-handlers";
import {
  type OAuthCookieJar,
  type OAuthCookieSetOptions,
} from "@/infrastructure/oauth-state";

const USER_ID = "user-synthetic-1";
const SYNTHETIC_CODE = "synthetic-whoop-code";
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
  store.set(WHOOP_OAUTH_STATE_COOKIE, { value: MATCH_STATE });
};

const authorizeDeps = (redirectUri: string): WhoopAuthorizeDeps => ({
  resolveActorId: async () => "local",
  ensureAppUser: async () => ({ id: USER_ID }),
  whoopAppConfig: () => ({ redirectUri }),
  createState: () => MATCH_STATE,
  buildAuthorizeUrl: (state) => `https://whoop.example.invalid/oauth?state=${state}`,
  readCookies: async () => jar,
  logError: (message, errorName) => {
    logged.push([message, errorName]);
  },
});

const callbackDeps = (): WhoopCallbackDeps => ({
  isConfigured: () => true,
  resolveActorId: async () => "local",
  ensureAppUser: async () => ({ id: USER_ID }),
  readCookies: async () => jar,
  exchangeAndPersistCode: async () => {
    exchangeCalls += 1;
  },
  syncForUser: async () => {},
  logError: (message, errorName) => {
    logged.push([message, errorName]);
  },
  logWarn: (message, details) => {
    warned.push([message, details]);
  },
});

const authorizeRequest = () => new Request("http://localhost:3000/api/whoop/authorize");

const callbackRequest = (query: string) =>
  new Request(`http://localhost:3000/api/whoop/callback?${query}`);

const whoopParam = (res: Response) =>
  new URL(res.headers.get("location") ?? "").searchParams.get("whoop");

beforeEach(() => {
  store.clear();
  exchangeCalls = 0;
  logged = [];
  warned = [];
});

describe("GET /api/whoop/authorize", () => {
  test("a localhost redirect sets a non-secure state cookie", async () => {
    const res = await createWhoopAuthorizeHandler(
      authorizeDeps("https://localhost:8788/api/whoop/callback"),
    )(authorizeRequest());
    expect(res.status).toBe(307);
    expect(store.get(WHOOP_OAUTH_STATE_COOKIE)).toEqual({
      value: MATCH_STATE,
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });
  });

  test("a non-localhost redirect sets a secure state cookie", async () => {
    const res = await createWhoopAuthorizeHandler(
      authorizeDeps("https://twinllm.example.invalid/api/whoop/callback"),
    )(authorizeRequest());
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      `https://whoop.example.invalid/oauth?state=${MATCH_STATE}`,
    );
    expect(store.get(WHOOP_OAUTH_STATE_COOKIE)?.secure).toBe(true);
  });
});

describe("GET /api/whoop/callback", () => {
  test("matching state exchanges once, redirects connected and clears the cookie", async () => {
    seedCookie();
    const res = await createWhoopCallbackHandler(callbackDeps())(
      callbackRequest(`code=${SYNTHETIC_CODE}&state=${MATCH_STATE}`),
    );
    expect(res.status).toBe(307);
    expect(whoopParam(res)).toBe("connected");
    expect(exchangeCalls).toBe(1);
    expect(store.has(WHOOP_OAUTH_STATE_COOKIE)).toBe(false);
  });

  test("missing state returns to expired and never exchanges", async () => {
    seedCookie();
    const res = await createWhoopCallbackHandler(callbackDeps())(
      callbackRequest(`code=${SYNTHETIC_CODE}`),
    );
    expect(res.status).toBe(307);
    expect(whoopParam(res)).toBe("expired");
    expect(exchangeCalls).toBe(0);
    expect(store.has(WHOOP_OAUTH_STATE_COOKIE)).toBe(false);
    expect(warned).toEqual([
      ["[whoop] callback state mismatch", { hasState: false, hasCookie: true }],
    ]);
  });

  test("mismatched state returns to expired and never exchanges", async () => {
    seedCookie();
    const res = await createWhoopCallbackHandler(callbackDeps())(
      callbackRequest(`code=${SYNTHETIC_CODE}&state=${OTHER_STATE}`),
    );
    expect(whoopParam(res)).toBe("expired");
    expect(exchangeCalls).toBe(0);
    expect(store.has(WHOOP_OAUTH_STATE_COOKIE)).toBe(false);
    expect(warned).toEqual([
      ["[whoop] callback state mismatch", { hasState: true, hasCookie: true }],
    ]);
    expect(JSON.stringify(warned)).not.toContain(OTHER_STATE);
    expect(JSON.stringify(warned)).not.toContain(MATCH_STATE);
  });

  test("missing cookie returns to expired and never exchanges", async () => {
    const res = await createWhoopCallbackHandler(callbackDeps())(
      callbackRequest(`code=${SYNTHETIC_CODE}&state=${MATCH_STATE}`),
    );
    expect(whoopParam(res)).toBe("expired");
    expect(exchangeCalls).toBe(0);
    expect(warned).toEqual([
      ["[whoop] callback state mismatch", { hasState: true, hasCookie: false }],
    ]);
  });

  test("a provider error redirects denied and never exchanges", async () => {
    seedCookie();
    const warned: Array<readonly [string, Readonly<Record<string, unknown>>]> = [];
    const res = await createWhoopCallbackHandler({
      ...callbackDeps(),
      logWarn: (message, details) => {
        warned.push([message, details]);
      },
    })(callbackRequest(`error=access_denied&state=${MATCH_STATE}`));
    expect(whoopParam(res)).toBe("denied");
    expect(exchangeCalls).toBe(0);
    expect(store.has(WHOOP_OAUTH_STATE_COOKIE)).toBe(false);
    expect(warned).toEqual([
      ["[whoop] callback rejected", { hasOauthError: true, hasCode: false }],
    ]);
  });

  test("unconfigured exit clears the cookie", async () => {
    seedCookie();
    const res = await createWhoopCallbackHandler({
      ...callbackDeps(),
      isConfigured: () => false,
    })(callbackRequest(`code=${SYNTHETIC_CODE}&state=${MATCH_STATE}`));
    expect(whoopParam(res)).toBe("unconfigured");
    expect(exchangeCalls).toBe(0);
    expect(store.has(WHOOP_OAUTH_STATE_COOKIE)).toBe(false);
  });

  test("signin exit clears the cookie", async () => {
    seedCookie();
    const res = await createWhoopCallbackHandler({
      ...callbackDeps(),
      resolveActorId: async () => null,
    })(callbackRequest(`code=${SYNTHETIC_CODE}&state=${MATCH_STATE}`));
    expect(whoopParam(res)).toBe("signin");
    expect(exchangeCalls).toBe(0);
    expect(store.has(WHOOP_OAUTH_STATE_COOKIE)).toBe(false);
  });

  test("a failing exchange logs the error name only", async () => {
    seedCookie();
    const res = await createWhoopCallbackHandler({
      ...callbackDeps(),
      exchangeAndPersistCode: async () => {
        throw new Error(SYNTHETIC_SECRET);
      },
    })(callbackRequest(`code=${SYNTHETIC_CODE}&state=${MATCH_STATE}`));
    expect(whoopParam(res)).toBe("error");
    expect(logged).toEqual([["[whoop] OAuth callback failed", "Error"]]);
  });

  test("a failing initial sync logs the error name only", async () => {
    seedCookie();
    const res = await createWhoopCallbackHandler({
      ...callbackDeps(),
      syncForUser: async () => {
        throw new TypeError(SYNTHETIC_SECRET);
      },
    })(callbackRequest(`code=${SYNTHETIC_CODE}&state=${MATCH_STATE}`));
    expect(whoopParam(res)).toBe("connected");
    expect(logged).toEqual([["[whoop] initial sync failed after connect", "TypeError"]]);
  });
});

describe("GET /api/whoop/authorize exits", () => {
  test("no actor returns to signin", async () => {
    const res = await createWhoopAuthorizeHandler({
      ...authorizeDeps("https://localhost:8788/api/whoop/callback"),
      resolveActorId: async () => null,
    })(authorizeRequest());
    expect(whoopParam(res)).toBe("signin");
  });

  test("missing config returns to unconfigured and sets no cookie", async () => {
    const res = await createWhoopAuthorizeHandler({
      ...authorizeDeps("https://localhost:8788/api/whoop/callback"),
      whoopAppConfig: () => null,
    })(authorizeRequest());
    expect(whoopParam(res)).toBe("unconfigured");
    expect(store.has(WHOOP_OAUTH_STATE_COOKIE)).toBe(false);
  });

  test("a failing user row returns to error and logs the error name only", async () => {
    const res = await createWhoopAuthorizeHandler({
      ...authorizeDeps("https://localhost:8788/api/whoop/callback"),
      ensureAppUser: async () => {
        throw new TypeError(SYNTHETIC_SECRET);
      },
    })(authorizeRequest());
    expect(whoopParam(res)).toBe("error");
    expect(logged).toEqual([["[whoop] authorize failed", "TypeError"]]);
  });
});

describe("GET /api/whoop/authorize redirect scheme", () => {
  test("an http:// redirect URI returns to unconfigured", async () => {
    const res = await createWhoopAuthorizeHandler(
      authorizeDeps("http://localhost:3000/api/whoop/callback"),
    )(authorizeRequest());
    expect(whoopParam(res)).toBe("unconfigured");
    expect(store.has(WHOOP_OAUTH_STATE_COOKIE)).toBe(false);
  });
});
