import "server-only";

import {
  exchangeWhoopCode,
  getWhoopAuthorizationUrl,
  refreshWhoopToken,
  type WhoopAppConfig,
} from "@open-twin/provider-whoop";
import type { Bundle } from "fhir/r4";

import { database } from "@/infrastructure/database";
import { whoopEnv } from "@/infrastructure/env";
import {
  buildWhoopFhirBundle,
  fetchWhoopWindow,
} from "@/infrastructure/open-twin-adapters/whoop";

import type { PreparedSync } from "@/features/wearables/audited-sync";
import {
  resolveSyncDateWindow,
  syncWindowToUtcTimestamps,
} from "@/features/wearables/sync-window";

import { buildWhoopSummary, type WhoopSummary } from "./summary";
import { decryptWhoopSecret, encryptWhoopSecret } from "./token-crypto";

type WhoopTokenResponse = Awaited<ReturnType<typeof exchangeWhoopCode>>;

export const whoopAppConfig = (): WhoopAppConfig | null => {
  const env = whoopEnv();
  if (!env) return null;
  return {
    clientId: env.clientId,
    clientSecret: env.clientSecret,
    redirectUri: env.redirectUri,
  };
};

export const buildWhoopAuthorizeUrl = (state: string): string => {
  const config = whoopAppConfig();
  if (!config) throw new Error("Whoop is not configured.");
  return getWhoopAuthorizationUrl(config, state);
};

export const persistWhoopTokens = async (params: {
  readonly userId: string;
  readonly tokens: WhoopTokenResponse;
}) => {
  const expiresAt = new Date(Date.now() + params.tokens.expires_in * 1000);
  const data = {
    accessTokenEnc: encryptWhoopSecret(params.tokens.access_token),
    refreshTokenEnc: encryptWhoopSecret(params.tokens.refresh_token),
    accessTokenExpiresAt: expiresAt,
  };

  await database().whoopConnection.upsert({
    where: { userId: params.userId },
    create: { userId: params.userId, ...data },
    update: data,
  });
};

export const exchangeAndPersistWhoopCode = async (params: {
  readonly userId: string;
  readonly code: string;
}) => {
  const config = whoopAppConfig();
  if (!config) throw new Error("Whoop is not configured.");
  const tokens = await exchangeWhoopCode(params.code, config);
  await persistWhoopTokens({ userId: params.userId, tokens });
};

const loadAccessTokenForUser = async (userId: string): Promise<string | null> => {
  const config = whoopAppConfig();
  if (!config) return null;

  const connection = await database().whoopConnection.findUnique({ where: { userId } });
  if (!connection) return null;

  const refreshToken = decryptWhoopSecret(connection.refreshTokenEnc);
  const stillValid = connection.accessTokenExpiresAt.getTime() - Date.now() > 60_000;

  if (stillValid) {
    return decryptWhoopSecret(connection.accessTokenEnc);
  }

  const tokens = await refreshWhoopToken(refreshToken, config);
  await persistWhoopTokens({ userId, tokens });
  return tokens.access_token;
};

/**
 * Fetches one Whoop sync and returns the summary with the step that stores it.
 * The snapshot and `lastSyncAt` are written only when `save` runs, which
 * `auditThenSave` does after the audit row.
 */
export const syncWhoopForUser = async (
  userId: string,
  options?: { readonly startDate?: string; readonly endDate?: string },
): Promise<PreparedSync<WhoopSummary>> => {
  const accessToken = await loadAccessTokenForUser(userId);
  if (!accessToken) throw new Error("Connect Whoop before syncing.");

  const { startDate, endDate } = resolveSyncDateWindow(options);
  const timestamps = syncWindowToUtcTimestamps({ startDate, endDate });

  const payload = await fetchWhoopWindow(accessToken, timestamps);

  const summary = buildWhoopSummary(payload, { startDate, endDate });

  let fhirBundle: Bundle | undefined;
  try {
    fhirBundle = buildWhoopFhirBundle(payload, {
      subjectKey: userId,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    // Summary still persists without a FHIR bundle.
    console.warn(
      "[whoop] FHIR bundle build skipped",
      error instanceof Error ? error.name : "unknown",
    );
  }

  const save = async () => {
    await database().whoopConnection.update({
      where: { userId },
      data: { lastSyncAt: new Date() },
    });

    await database().whoopSnapshot.create({
      data: {
        userId,
        startDate,
        endDate,
        summary,
        fhirBundle: fhirBundle as object | undefined,
      },
    });
  };

  return { synced: summary, save };
};

export const getLatestWhoopSummary = async (
  userId: string,
): Promise<WhoopSummary | null> => {
  const snap = await database().whoopSnapshot.findFirst({
    where: { userId },
    orderBy: { syncedAt: "desc" },
    select: { summary: true },
  });

  if (!snap) return null;
  return snap.summary as unknown as WhoopSummary;
};

export const getWhoopConnectionStatus = async (userId: string) => {
  const connection = await database().whoopConnection.findUnique({
    where: { userId },
    select: { linkedAt: true, lastSyncAt: true },
  });

  return {
    configured: whoopEnv() !== null,
    connected: connection !== null,
    linkedAt: connection?.linkedAt?.toISOString() ?? null,
    lastSyncAt: connection?.lastSyncAt?.toISOString() ?? null,
  };
};

export const disconnectWhoop = async (userId: string) => {
  await database().whoopConnection.deleteMany({ where: { userId } });
};
