import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { GOOGLE_HEALTH_OAUTH_STATE_COOKIE } from "./oauth-cookie";
import {
  connectorsReturnUrl,
  oauthStateMatches,
  stateMismatchDetails,
  type ConnectorReturn,
  type OAuthCookieJar,
} from "@/infrastructure/oauth-state";

/**
 * Google Health authorize and callback GET, as factories (same shape as Oura),
 * so the route files export only GET and tests inject fakes instead of
 * replacing modules.
 */

export const readGoogleHealthCookies = () => cookies();

export type GoogleHealthAuthorizeDeps = {
  readonly resolveActorId: () => Promise<string | null>;
  readonly ensureAppUser: (clerkId: string) => Promise<{ readonly id: string }>;
  readonly googleHealthAppConfig: () => { readonly redirectUri: string } | null;
  readonly createState: () => string;
  readonly buildAuthorizeUrl: () => string;
  readonly readCookies: () => OAuthCookieJar | Promise<OAuthCookieJar>;
  /** Receives the error name only, never the error object. */
  readonly logError: (message: string, errorName: string) => void;
};

export type GoogleHealthCallbackDeps = {
  readonly isConfigured: () => boolean;
  readonly resolveActorId: () => Promise<string | null>;
  readonly ensureAppUser: (clerkId: string) => Promise<{ readonly id: string }>;
  readonly readCookies: () => OAuthCookieJar | Promise<OAuthCookieJar>;
  readonly exchangeAndPersistCode: (params: {
    readonly userId: string;
    readonly code: string;
  }) => Promise<unknown>;
  readonly syncForUser: (userId: string) => Promise<unknown>;
  /** Receives the error name only, never the error object. */
  readonly logError: (message: string, errorName: string) => void;
  readonly logWarn: (message: string, details: Readonly<Record<string, unknown>>) => void;
};

const back = (outcome: ConnectorReturn, request: Request) =>
  NextResponse.redirect(connectorsReturnUrl("google-health", outcome, request.url));

const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : "unknown";

export const createGoogleHealthAuthorizeHandler = (deps: GoogleHealthAuthorizeDeps) => {
  /** Every exit returns to /connectors; a JSON page there is a dead end. */
  return async (request: Request) => {
    try {
      const clerkId = await deps.resolveActorId();
      if (!clerkId) return back("signin", request);

      await deps.ensureAppUser(clerkId);

      const config = deps.googleHealthAppConfig();
      if (!config) return back("unconfigured", request);

      const state = deps.createState();
      const jar = await deps.readCookies();
      const localHttpApp = config.redirectUri.includes("localhost");
      jar.set(GOOGLE_HEALTH_OAUTH_STATE_COOKIE, state, {
        httpOnly: true,
        secure: !localHttpApp && config.redirectUri.startsWith("https://"),
        sameSite: "lax",
        maxAge: 600,
        path: "/",
      });

      const url = new URL(deps.buildAuthorizeUrl());
      url.searchParams.set("state", state);

      return NextResponse.redirect(url.toString());
    } catch (error) {
      deps.logError("[google-health] authorize failed", errorName(error));
      return back("error", request);
    }
  };
};

export const createGoogleHealthCallbackHandler = (deps: GoogleHealthCallbackDeps) => {
  /**
   * Google redirects here with ?code=&state= after the wearer grants scopes.
   * State must match the cookie set in authorize. A mismatch returns to
   * /connectors?google-health=expired before any token exchange; the cookie is
   * cleared on every path.
   */
  return async (request: Request) => {
    const jar = await deps.readCookies();
    const expected = jar.get(GOOGLE_HEALTH_OAUTH_STATE_COOKIE)?.value;
    jar.delete(GOOGLE_HEALTH_OAUTH_STATE_COOKIE);

    if (!deps.isConfigured()) {
      return back("unconfigured", request);
    }

    const clerkId = await deps.resolveActorId();
    if (!clerkId) {
      return back("signin", request);
    }

    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const oauthError = url.searchParams.get("error");

    if (oauthError || !code) {
      deps.logWarn("[google-health] callback rejected", {
        hasOauthError: Boolean(oauthError),
        hasCode: Boolean(code),
      });
      return back("denied", request);
    }

    if (!oauthStateMatches(state, expected)) {
      deps.logWarn(
        "[google-health] callback state mismatch",
        stateMismatchDetails(state, expected),
      );
      return back("expired", request);
    }

    try {
      const { id: appUserId } = await deps.ensureAppUser(clerkId);
      await deps.exchangeAndPersistCode({ userId: appUserId, code });
      await deps.syncForUser(appUserId).catch((error: unknown) => {
        deps.logError(
          "[google-health] initial sync failed after connect",
          errorName(error),
        );
      });
      return back("connected", request);
    } catch (error) {
      deps.logError("[google-health] OAuth callback failed", errorName(error));
      return back("error", request);
    }
  };
};
