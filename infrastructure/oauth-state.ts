/**
 * OAuth CSRF state and return outcomes shared by every wearable connector
 * (Oura, Whoop, Google Health).
 *
 * Authorize and callback are browser navigations, so every exit goes back to
 * the Connectors page with one outcome word (`/connectors?oura=expired`). A
 * JSON body there is a dead end the user can only read as a browser error.
 * A missing or mismatched state still exits before any token exchange.
 */

export const CONNECTOR_RETURNS = [
  "connected",
  "denied",
  "error",
  "expired",
  "locked",
  "signin",
  "unconfigured",
] as const;

export type ConnectorReturn = (typeof CONNECTOR_RETURNS)[number];

/** The query parameter each connector reports on, e.g. `google-health=denied`. */
export type ConnectorReturnParam = "oura" | "whoop" | "google-health";

export const connectorsReturnUrl = (
  param: ConnectorReturnParam,
  outcome: ConnectorReturn,
  requestUrl: string,
): URL => new URL(`/connectors?${param}=${outcome}`, requestUrl);

/** Booleans only: never the state, the cookie or the code. */
export const stateMismatchDetails = (
  state: string | null,
  expected: string | undefined,
): Readonly<{ hasState: boolean; hasCookie: boolean }> => ({
  hasState: Boolean(state),
  hasCookie: Boolean(expected),
});

export type OAuthCookieSetOptions = {
  readonly httpOnly: boolean;
  readonly secure: boolean;
  readonly sameSite: "lax";
  readonly maxAge: number;
  readonly path: string;
};

/** The slice of Next's cookie store the OAuth handlers use; tests pass a Map-backed fake. */
export type OAuthCookieJar = {
  get: (name: string) => { readonly value: string } | undefined;
  set: (name: string, value: string, options: OAuthCookieSetOptions) => void;
  delete: (name: string) => void;
};

/** Callback state matches only when both values exist and are equal. */
export const oauthStateMatches = (
  state: string | null,
  expected: string | undefined,
): boolean => Boolean(state && expected && state === expected);
