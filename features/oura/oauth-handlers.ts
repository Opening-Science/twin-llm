import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { createOuraOAuthState, OURA_OAUTH_STATE_COOKIE } from "./oauth-cookie";
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
  vendorAuthDisclosure,
  vendorSyncDisclosure,
} from "@/features/wearables/audited-sync";
import type { RecordDisclosure } from "@/infrastructure/disclosure-ledger";
import type { PersonalRead } from "@/infrastructure/personal-read-audit";
import { getAuthorizationUrl } from "@/infrastructure/open-twin-adapters/oura-authorize";

/**
 * Oura authorize and callback GET, as factories, so the Next route files can
 * export only GET and tests can pass fakes without replacing modules for the
 * whole bun process.
 */

export const readOuraCookies = () => cookies();

export type OuraCookieJar = OAuthCookieJar;

export type OuraAuthorizeDeps = {
  readonly resolveActorId: () => Promise<string | null>;
  readonly ensureAppUser: (clerkId: string) => Promise<{ readonly id: string }>;
  readonly ouraAppConfig: () => Parameters<typeof getAuthorizationUrl>[0] | null;
  readonly readCookies: () => OuraCookieJar | Promise<OuraCookieJar>;
  /** Receives the error name only, never the error object. */
  readonly logError: (message: string, errorName: string) => void;
};

export type OuraCallbackDeps = {
  readonly ouraEnv: () => unknown;
  readonly resolveActorId: () => Promise<string | null>;
  readonly ensureAppUser: (clerkId: string) => Promise<{ readonly id: string }>;
  readonly readCookies: () => OuraCookieJar | Promise<OuraCookieJar>;
  readonly createTokenHandlerFromCode: (authorizationCode: string) => Promise<{
    lastTokens: () => {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    } | null;
  }>;
  readonly persistOuraTokens: (params: {
    readonly userId: string;
    readonly accessToken: string;
    readonly refreshToken: string;
    readonly expiresIn: number;
    readonly subjectKey?: string | null;
  }) => Promise<void>;
  /** The first sync after connect; it goes through `auditThenSave`, which stores it only after the audit row. */
  readonly syncOuraForUser: (userId: string) => Promise<PreparedSync<SyncedMetrics>>;
  readonly auditPersonalRead: (read: PersonalRead) => Promise<unknown>;
  /**
   * Writes the code exchange and the first sync's request to the disclosure
   * ledger (#140) before each is sent; when it fails, neither is sent.
   */
  readonly recordDisclosure: RecordDisclosure;
  /**
   * Whether this person's data is unlocked in this process (#142). The
   * return from the provider is a cross-site redirect, so the SameSite=Strict
   * unlock cookie is not sent; the tokens are stored either way, and the
   * first sync runs only while the vault is open.
   */
  readonly mayReadPersonal: (actorId: string) => boolean;
  /** Receives the error name only, never the error object. */
  readonly logError: (message: string, errorName: string) => void;
  /** Booleans only, never a state, cookie or code value. */
  readonly logWarn: (message: string, details: Readonly<Record<string, boolean>>) => void;
};

const back = (outcome: ConnectorReturn, request: Request) =>
  NextResponse.redirect(connectorsReturnUrl("oura", outcome, request.url));

const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : "unknown";

export const createOuraAuthorizeHandler = (deps: OuraAuthorizeDeps) => {
  /** Every exit returns to /connectors; a JSON page there is a dead end. */
  return async (request: Request) => {
    try {
      const clerkId = await deps.resolveActorId();
      if (!clerkId) return back("signin", request);

      // Lazy user row — same as first prompt — so Connect works before any chat.
      await deps.ensureAppUser(clerkId);

      const config = deps.ouraAppConfig();
      if (!config) return back("unconfigured", request);

      const state = createOuraOAuthState();
      const jar = await deps.readCookies();
      const localHttpApp = config.redirectUri.includes("localhost");
      jar.set(OURA_OAUTH_STATE_COOKIE, state, {
        httpOnly: true,
        secure: !localHttpApp,
        sameSite: "lax",
        maxAge: 600,
        path: "/",
      });

      return NextResponse.redirect(
        getAuthorizationUrl(config as Parameters<typeof getAuthorizationUrl>[0], state),
      );
    } catch (error) {
      deps.logError("[oura] authorize failed", errorName(error));
      return back("error", request);
    }
  };
};

export const createOuraCallbackHandler = (deps: OuraCallbackDeps) => {
  /**
   * Oura redirects here with ?code=&state= after the wearer grants scopes.
   * State must match the 8-char cookie set in authorize. A mismatch returns to
   * /connectors?oura=expired before any token exchange; the cookie is cleared
   * on every path.
   */
  return async (request: Request) => {
    const jar = await deps.readCookies();
    const expected = jar.get(OURA_OAUTH_STATE_COOKIE)?.value;
    jar.delete(OURA_OAUTH_STATE_COOKIE);

    const env = deps.ouraEnv();
    if (!env) {
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
      return back("denied", request);
    }

    if (!oauthStateMatches(state, expected)) {
      deps.logWarn(
        "[oura] callback state mismatch",
        stateMismatchDetails(state, expected),
      );
      return back("expired", request);
    }

    try {
      const { id: appUserId } = await deps.ensureAppUser(clerkId);
      await deps.recordDisclosure(vendorAuthDisclosure("oura", clerkId));
      const handler = await deps.createTokenHandlerFromCode(code);
      const tokens = handler.lastTokens();
      if (!tokens) throw new Error("Token exchange returned no tokens.");

      await deps.persistOuraTokens({
        userId: appUserId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        subjectKey: appUserId,
      });

      if (deps.mayReadPersonal(clerkId)) {
        await auditThenSave(
          () => deps.syncOuraForUser(appUserId),
          "oura",
          clerkId,
          deps.auditPersonalRead,
          () => deps.recordDisclosure(vendorSyncDisclosure("oura", clerkId)),
        ).catch((error: unknown) => {
          deps.logError("[oura] initial sync failed after connect", errorName(error));
        });
      }

      return back("connected", request);
    } catch (error) {
      deps.logError("[oura] OAuth callback failed", errorName(error));
      return back("error", request);
    }
  };
};
