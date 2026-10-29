import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { WHOOP_OAUTH_STATE_COOKIE } from "./oauth-cookie";
import {
  connectorsReturnUrl,
  oauthStateMatches,
  stateMismatchDetails,
  type ConnectorReturn,
  type OAuthCookieJar,
} from "@/infrastructure/oauth-state";
import {
  auditThenSave,
  type PreparedSync,
  type SyncedMetrics,
} from "@/features/wearables/audited-sync";
import type { PersonalRead } from "@/infrastructure/personal-read-audit";

/**
 * Whoop authorize and callback GET, as factories (same shape as Oura), so the
 * route files export only GET and tests inject fakes instead of replacing modules.
 */

export const readWhoopCookies = () => cookies();

export type WhoopAuthorizeDeps = {
  readonly resolveActorId: () => Promise<string | null>;
  readonly ensureAppUser: (clerkId: string) => Promise<{ readonly id: string }>;
  readonly whoopAppConfig: () => { readonly redirectUri: string } | null;
  readonly createState: () => string;
  readonly buildAuthorizeUrl: (state: string) => string;
  readonly readCookies: () => OAuthCookieJar | Promise<OAuthCookieJar>;
  /** Receives the error name only, never the error object. */
  readonly logError: (message: string, errorName: string) => void;
};

export type WhoopCallbackDeps = {
  readonly isConfigured: () => boolean;
  readonly resolveActorId: () => Promise<string | null>;
  readonly ensureAppUser: (clerkId: string) => Promise<{ readonly id: string }>;
  readonly readCookies: () => OAuthCookieJar | Promise<OAuthCookieJar>;
  readonly exchangeAndPersistCode: (params: {
    readonly userId: string;
    readonly code: string;
  }) => Promise<unknown>;
  /** The first sync after connect; it goes through `auditThenSave`, which stores it only after the audit row. */
  readonly syncForUser: (userId: string) => Promise<PreparedSync<SyncedMetrics>>;
  readonly auditPersonalRead: (read: PersonalRead) => Promise<unknown>;
  /** Receives the error name only, never the error object. */
  readonly logError: (message: string, errorName: string) => void;
  readonly logWarn: (message: string, details: Readonly<Record<string, unknown>>) => void;
};

const back = (outcome: ConnectorReturn, request: Request) =>
  NextResponse.redirect(connectorsReturnUrl("whoop", outcome, request.url));

const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : "unknown";

export const createWhoopAuthorizeHandler = (deps: WhoopAuthorizeDeps) => {
  /** Every exit returns to /connectors; a JSON page there is a dead end. */
  return async (request: Request) => {
    try {
      const clerkId = await deps.resolveActorId();
      if (!clerkId) return back("signin", request);

      await deps.ensureAppUser(clerkId);

      const config = deps.whoopAppConfig();
      // Whoop only accepts https:// (or whoop://) redirects; anything else is
      // a setup problem the Setup list on the card explains.
      if (
        !config ||
        (!config.redirectUri.startsWith("https://") &&
          !config.redirectUri.startsWith("whoop://"))
      ) {
        return back("unconfigured", request);
      }

      const state = deps.createState();
      const jar = await deps.readCookies();
      // Next is http://localhost:3000; only the Whoop redirect proxy is https.
      // A Secure cookie set on HTTP would not round-trip to the callback.
      const localHttpApp = config.redirectUri.includes("localhost");
      jar.set(WHOOP_OAUTH_STATE_COOKIE, state, {
        httpOnly: true,
        secure: !localHttpApp,
        sameSite: "lax",
        maxAge: 600,
        path: "/",
      });

      return NextResponse.redirect(deps.buildAuthorizeUrl(state));
    } catch (error) {
      deps.logError("[whoop] authorize failed", errorName(error));
      return back("error", request);
    }
  };
};

export const createWhoopCallbackHandler = (deps: WhoopCallbackDeps) => {
  /**
   * Whoop redirects here with ?code=&state= after the wearer grants scopes.
   * State must match the cookie set in authorize. A mismatch returns to
   * /connectors?whoop=expired before any token exchange; the cookie is
   * cleared on every path.
   */
  return async (request: Request) => {
    const jar = await deps.readCookies();
    const expected = jar.get(WHOOP_OAUTH_STATE_COOKIE)?.value;
    jar.delete(WHOOP_OAUTH_STATE_COOKIE);

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
      deps.logWarn("[whoop] callback rejected", {
        hasOauthError: Boolean(oauthError),
        hasCode: Boolean(code),
      });
      return back("denied", request);
    }

    if (!oauthStateMatches(state, expected)) {
      deps.logWarn(
        "[whoop] callback state mismatch",
        stateMismatchDetails(state, expected),
      );
      return back("expired", request);
    }

    try {
      const { id: appUserId } = await deps.ensureAppUser(clerkId);
      await deps.exchangeAndPersistCode({ userId: appUserId, code });
      await auditThenSave(
        () => deps.syncForUser(appUserId),
        "whoop",
        clerkId,
        deps.auditPersonalRead,
      ).catch((error: unknown) => {
        deps.logError("[whoop] initial sync failed after connect", errorName(error));
      });
      return back("connected", request);
    } catch (error) {
      deps.logError("[whoop] OAuth callback failed", errorName(error));
      return back("error", request);
    }
  };
};
