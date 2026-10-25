import {
  buildWhoopBundleFromPayload,
  getWhoopData,
  TokenHandler,
  type WhoopSyncPayload,
  type WhoopWindow,
} from "@open-twin/provider-whoop";
import type { Bundle } from "fhir/r4";

/**
 * Fetches recovery / cycle / sleep for a window using a host-held access token.
 * The host owns refresh (features/whoop/connection.ts), so the TokenHandler only
 * carries a live access token; the placeholder config is never used to refresh
 * because the token is valid for the whole sync.
 */
export const fetchWhoopWindow = async (
  accessToken: string,
  window: WhoopWindow,
): Promise<WhoopSyncPayload> => {
  const handler = new TokenHandler(
    {
      clientId: "host",
      clientSecret: "host",
      redirectUri: "https://localhost/callback",
    },
    "",
  );
  handler.setTokens({
    access_token: accessToken,
    refresh_token: "host-held",
    expires_in: 3_600,
    token_type: "bearer",
  });

  const { data, issues } = await getWhoopData(window, handler, { subjectKey: "host" });
  if (
    issues !== undefined &&
    data.recovery.length + data.cycles.length + data.sleep.length === 0
  ) {
    throw new Error(
      issues.issue.map((issue) => issue.diagnostics ?? issue.code).join("; ") ||
        "Whoop sync failed",
    );
  }
  return data;
};

export const buildWhoopFhirBundle = (
  payload: WhoopSyncPayload,
  options: { readonly subjectKey: string; readonly timestamp: string },
): Bundle =>
  buildWhoopBundleFromPayload(payload, {
    subjectKey: options.subjectKey,
    timestamp: options.timestamp,
  });
