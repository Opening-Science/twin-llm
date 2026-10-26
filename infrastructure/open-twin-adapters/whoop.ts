import {
  buildWhoopBundleFromPayload,
  getWhoopData,
  TokenHandler,
  type WhoopSyncPayload,
  type WhoopWindow,
} from "@open-twin/provider-whoop";
import type { Bundle } from "fhir/r4";

import {
  fetchWhoopWorkouts,
  withWhoopWorkouts,
  type WhoopWorkout,
} from "./whoop-workout";

export type { WhoopWorkout };

/** Upstream recovery / cycles / sleep plus the workouts this host fetches itself. */
export type WhoopHostPayload = WhoopSyncPayload & {
  readonly workouts: readonly WhoopWorkout[];
};

/**
 * Fetches recovery / cycle / sleep / workouts for a window using a host-held
 * access token. The host owns refresh (features/whoop/connection.ts), so the
 * TokenHandler only carries a live access token; the placeholder config is never
 * used to refresh because the token is valid for the whole sync.
 */
export const fetchWhoopWindow = async (
  accessToken: string,
  window: WhoopWindow,
): Promise<WhoopHostPayload> => {
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

  const [{ data, issues }, workoutResult] = await Promise.all([
    getWhoopData(window, handler, { subjectKey: "host" }),
    fetchWhoopWorkouts(accessToken, window).then(
      (workouts) => ({ workouts, failed: false }),
      () => ({ workouts: [] as WhoopWorkout[], failed: true }),
    ),
  ]);

  const fetched =
    data.recovery.length +
    data.cycles.length +
    data.sleep.length +
    workoutResult.workouts.length;
  if ((issues !== undefined || workoutResult.failed) && fetched === 0) {
    const messages = [
      ...(issues?.issue ?? []).map((issue) => issue.diagnostics ?? issue.code),
      ...(workoutResult.failed ? ["Failed to fetch workouts"] : []),
    ];
    throw new Error(messages.join("; ") || "Whoop sync failed");
  }
  return { ...data, workouts: workoutResult.workouts };
};

export const buildWhoopFhirBundle = (
  payload: WhoopHostPayload,
  options: { readonly subjectKey: string; readonly timestamp: string },
): Bundle =>
  withWhoopWorkouts(
    buildWhoopBundleFromPayload(
      { recovery: payload.recovery, cycles: payload.cycles, sleep: payload.sleep },
      { subjectKey: options.subjectKey, timestamp: options.timestamp },
    ),
    payload.workouts,
    options,
  );
