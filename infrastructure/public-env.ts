/**
 * Browser-visible configuration, the only module besides `./env` that reads
 * `process.env`.
 *
 * Next inlines `NEXT_PUBLIC_*` values into the client bundle only where it
 * sees a literal `process.env.NEXT_PUBLIC_X` access, so every read is written
 * out here once. A client component cannot use `./env` (server-only).
 *
 * Values may be missing: a build with no environment must still render.
 */
export const publicEnv = Object.freeze({
  clerkPublishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  posthogKey: process.env.NEXT_PUBLIC_POSTHOG_KEY,
  posthogHost: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  /** Browser analytics are off unless this is exactly "true". */
  posthogBrowser: process.env.NEXT_PUBLIC_POSTHOG_BROWSER,
}) satisfies Readonly<Record<string, string | undefined>>;

const EU_POSTHOG_HOST = "https://eu.i.posthog.com";

export type BrowserAnalyticsConfig = Readonly<{ key: string; host: string }>;

/**
 * Browser PostHog settings, or null when browser analytics must stay off.
 *
 * Off by default: the deployment has to opt in with
 * NEXT_PUBLIC_POSTHOG_BROWSER=true as well as a key. There is no consent
 * banner, so an operator who turns this on is responsible for consent.
 */
export const browserAnalyticsConfig = (
  values: Readonly<{
    posthogKey?: string;
    posthogHost?: string;
    posthogBrowser?: string;
  }> = publicEnv,
): BrowserAnalyticsConfig | null => {
  const key = values.posthogKey?.trim();
  if (!key || values.posthogBrowser?.trim() !== "true") return null;
  return { key, host: values.posthogHost?.trim() || EU_POSTHOG_HOST };
};

/**
 * Clerk is on only with a publishable key and neither auth-off flag set.
 * Read at call time (not frozen above) so the root layout, the client auth
 * wrapper and the shell layout agree, and tests can vary the environment.
 */
export const isClerkEnabled = (): boolean => {
  const authOff =
    process.env.NEXT_PUBLIC_LOCAL_MVP === "true" ||
    process.env.NEXT_PUBLIC_AUTH_DISABLED === "true";
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) && !authOff;
};
