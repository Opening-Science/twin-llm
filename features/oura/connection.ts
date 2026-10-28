import "server-only";

import { getOuraData, type SupportedScope } from "@open-twin/provider-oura";

import { database } from "@/infrastructure/database";
import { ouraEnv } from "@/infrastructure/env";
import { HostOuraTokenHandler } from "@/infrastructure/open-twin-adapters/oura";
import { buildOuraFhirBundle } from "@/infrastructure/open-twin-adapters/oura-bundle";

import type { PreparedSync } from "@/features/wearables/audited-sync";
import { resolveSyncDateWindow } from "@/features/wearables/sync-window";

import { buildOuraSummary, type OuraSummary } from "./summary";
import { decryptSecret, encryptSecret } from "./token-crypto";

/** Oura v2 collections one sync fetches, in request order. */
export const OURA_SYNC_TYPES = [
  "personal_info",
  "sleep",
  "daily_readiness",
  "daily_activity",
  "workout",
  "daily_spo2",
  "daily_stress",
  "vO2_max",
] as const satisfies readonly SupportedScope[];

/**
 * Oura OAuth scopes (cloud.ouraring.com/docs/authentication).
 * Distinct from OURA_SYNC_TYPES — those are v2 API collection names used only
 * when fetching data. Sending collection names as `scope=` yields
 * invalid_request. `workout` covers workouts and `spo2` the nightly SpO2
 * average; Oura names no scope of their own for daily_stress and vO2_max.
 */
export const OURA_OAUTH_SCOPES = [
  "email",
  "personal",
  "daily",
  "workout",
  "spo2",
] as const;

export const ouraAppConfig = () => {
  const env = ouraEnv();
  if (!env) return null;

  return {
    clientId: env.clientId,
    clientSecret: env.clientSecret,
    redirectUri: env.redirectUri,
    // OpenTwin types `scopes` as API collections; OAuth needs email/personal/daily.
    scopes: [...OURA_OAUTH_SCOPES] as never as SupportedScope[],
  };
};

export const createTokenHandlerFromCode = async (authorizationCode: string) => {
  const config = ouraAppConfig();
  if (!config) throw new Error("Oura is not configured.");

  const handler = new HostOuraTokenHandler(config, authorizationCode);
  await handler.authenticate();
  return handler;
};

export const loadTokenHandlerForUser = async (userId: string) => {
  const config = ouraAppConfig();
  if (!config) return null;

  const connection = await database().ouraConnection.findUnique({ where: { userId } });
  if (!connection) return null;

  const handler = new HostOuraTokenHandler(config, "");
  handler.setTokens({
    access_token: decryptSecret(connection.accessTokenEnc),
    refresh_token: decryptSecret(connection.refreshTokenEnc),
    token_type: "bearer",
    expires_in: Math.max(
      60,
      Math.floor((connection.accessTokenExpiresAt.getTime() - Date.now()) / 1000),
    ),
  });

  return { handler, connection };
};

export const persistOuraTokens = async (params: {
  readonly userId: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
  readonly subjectKey?: string | null;
}) => {
  const expiresAt = new Date(Date.now() + params.expiresIn * 1000);
  const data = {
    accessTokenEnc: encryptSecret(params.accessToken),
    refreshTokenEnc: encryptSecret(params.refreshToken),
    accessTokenExpiresAt: expiresAt,
    subjectKey: params.subjectKey ?? undefined,
  };

  await database().ouraConnection.upsert({
    where: { userId: params.userId },
    create: { userId: params.userId, ...data },
    update: data,
  });
};

/**
 * Fetches one Oura sync and returns the summary with the step that stores it.
 * Refreshed tokens are stored at once; the snapshot and `lastSyncAt` only
 * when `save` runs, which `auditThenSave` does after the audit row.
 */
export const syncOuraForUser = async (
  userId: string,
  options: {
    readonly sandbox?: boolean;
    readonly startDate?: string;
    readonly endDate?: string;
  } = {},
): Promise<PreparedSync<OuraSummary>> => {
  const loaded = await loadTokenHandlerForUser(userId);
  if (!loaded) throw new Error("Connect Oura before syncing.");

  const { startDate, endDate } = resolveSyncDateWindow(options);

  const request = {
    types: [...OURA_SYNC_TYPES],
    start_date: startDate,
    end_date: endDate,
  };

  const dataResult = options.sandbox
    ? await getOuraData(request, loaded.handler, { sandbox: true })
    : await getOuraData(request, loaded.handler);

  // The bundle is built from the same responses as the summary, so one sync
  // calls each endpoint once.
  let fhirBundle: unknown = null;
  try {
    fhirBundle = buildOuraFhirBundle(dataResult.data, request, {
      subjectKey: loaded.connection.subjectKey ?? userId,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    // Summary still works without a FHIR bundle (e.g. missing personal_info subject).
    console.warn(
      "[oura] FHIR bundle build skipped",
      error instanceof Error ? error.name : "unknown",
    );
  }

  const summary = buildOuraSummary(dataResult.data, { startDate, endDate });

  const tokens = loaded.handler.lastTokens();
  if (tokens) {
    await persistOuraTokens({
      userId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      subjectKey: loaded.connection.subjectKey,
    });
  }

  const save = async () => {
    await database().ouraConnection.update({
      where: { userId },
      data: { lastSyncAt: new Date() },
    });

    await database().ouraSnapshot.create({
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

export const getLatestOuraSummary = async (
  userId: string,
  ports?: { readonly database?: typeof database },
): Promise<OuraSummary | null> => {
  const db = ports?.database ?? database;
  const snap = await db().ouraSnapshot.findFirst({
    where: { userId },
    orderBy: { syncedAt: "desc" },
    select: { summary: true },
  });

  if (!snap) return null;
  return snap.summary as unknown as OuraSummary;
};

export const getOuraConnectionStatus = async (userId: string) => {
  const connection = await database().ouraConnection.findUnique({
    where: { userId },
    select: { linkedAt: true, lastSyncAt: true },
  });

  return {
    configured: ouraEnv() !== null,
    connected: connection !== null,
    linkedAt: connection?.linkedAt?.toISOString() ?? null,
    lastSyncAt: connection?.lastSyncAt?.toISOString() ?? null,
  };
};

export const disconnectOura = async (userId: string) => {
  await database().ouraConnection.deleteMany({ where: { userId } });
};
