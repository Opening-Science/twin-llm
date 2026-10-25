import "server-only";

import { randomBytes } from "node:crypto";

import {
  GoogleHealthClient,
  getFhirBundleFromGoogleHealthData,
  getGoogleHealthAuthUrl,
  initializeGoogleHealthClient,
  type AllType,
} from "@open-twin/provider-google-health";
import type { Auth } from "googleapis";

import { database } from "@/infrastructure/database";
import { googleHealthEnv } from "@/infrastructure/env";
import {
  getGoogleHealthCredentials,
  setGoogleHealthCredentials,
} from "@/infrastructure/open-twin-adapters/google-health";

import { resolveSyncDateWindow } from "@/features/wearables/sync-window";

import { buildGoogleHealthSummary, type GoogleHealthSummary } from "./summary";
import { decryptGoogleHealthSecret, encryptGoogleHealthSecret } from "./token-crypto";

/** Core types for an evening demo — dense enough without flooding heart-rate samples. */
const SYNC_TYPES = [
  "steps",
  "sleep",
  "daily-resting-heart-rate",
  "daily-heart-rate-variability",
  "daily-oxygen-saturation",
  "active-minutes",
  "distance",
  "weight",
] as const satisfies readonly AllType[];

export const createGoogleHealthOAuthState = (): string => randomBytes(16).toString("hex");

export const googleHealthAppConfig = () => {
  const env = googleHealthEnv();
  if (!env) return null;
  return {
    clientId: env.clientId,
    clientSecret: env.clientSecret,
    redirectUri: env.redirectUri,
  };
};

export const buildGoogleHealthAuthorizeUrl = (): string => {
  const config = googleHealthAppConfig();
  if (!config) throw new Error("Google Health is not configured.");
  const client = new GoogleHealthClient(config);
  return getGoogleHealthAuthUrl(client);
};

const toExpiry = (tokens: Auth.Credentials): Date => {
  if (typeof tokens.expiry_date === "number") {
    return new Date(tokens.expiry_date);
  }
  // Google usually returns ~1h; persist a conservative estimate when missing.
  return new Date(Date.now() + 3_500_000);
};

export const persistGoogleHealthTokens = async (params: {
  readonly userId: string;
  readonly tokens: Auth.Credentials;
  readonly subjectKey?: string;
}) => {
  if (!params.tokens.access_token || !params.tokens.refresh_token) {
    throw new Error(
      "Google Health did not return both access and refresh tokens. Re-consent with prompt=consent.",
    );
  }

  const data = {
    accessTokenEnc: encryptGoogleHealthSecret(params.tokens.access_token),
    refreshTokenEnc: encryptGoogleHealthSecret(params.tokens.refresh_token),
    accessTokenExpiresAt: toExpiry(params.tokens),
    ...(params.subjectKey ? { subjectKey: params.subjectKey } : {}),
  };

  await database().googleHealthConnection.upsert({
    where: { userId: params.userId },
    create: { userId: params.userId, ...data },
    update: data,
  });
};

export const exchangeAndPersistGoogleHealthCode = async (params: {
  readonly userId: string;
  readonly code: string;
}) => {
  const config = googleHealthAppConfig();
  if (!config) throw new Error("Google Health is not configured.");

  const client = new GoogleHealthClient(config);
  const tokens = await initializeGoogleHealthClient(client, params.code);
  await persistGoogleHealthTokens({
    userId: params.userId,
    tokens,
    subjectKey: params.userId,
  });
};

const loadClientForUser = async (userId: string): Promise<GoogleHealthClient | null> => {
  const config = googleHealthAppConfig();
  if (!config) return null;

  const connection = await database().googleHealthConnection.findUnique({
    where: { userId },
  });
  if (!connection) return null;

  const client = new GoogleHealthClient(config);
  setGoogleHealthCredentials(client, {
    access_token: decryptGoogleHealthSecret(connection.accessTokenEnc),
    refresh_token: decryptGoogleHealthSecret(connection.refreshTokenEnc),
    expiry_date: connection.accessTokenExpiresAt.getTime(),
    token_type: "Bearer",
  });

  return client;
};

const persistRefreshedCredentials = async (
  userId: string,
  client: GoogleHealthClient,
) => {
  const tokens = getGoogleHealthCredentials(client);
  if (!tokens.access_token || !tokens.refresh_token) return;

  await database().googleHealthConnection.update({
    where: { userId },
    data: {
      accessTokenEnc: encryptGoogleHealthSecret(tokens.access_token),
      refreshTokenEnc: encryptGoogleHealthSecret(tokens.refresh_token),
      accessTokenExpiresAt: toExpiry(tokens),
    },
  });
};

export const syncGoogleHealthForUser = async (
  userId: string,
  options?: { readonly startDate?: string; readonly endDate?: string },
): Promise<GoogleHealthSummary> => {
  const client = await loadClientForUser(userId);
  if (!client) throw new Error("Connect Google Health before syncing.");

  const connection = await database().googleHealthConnection.findUnique({
    where: { userId },
    select: { subjectKey: true },
  });

  const { startDate, endDate } = resolveSyncDateWindow(options);
  // Google Health wants ISO timestamps; civil-date types use the wearer's zone.
  const startIso = `${startDate}T00:00:00Z`;
  const endIso = `${endDate}T23:59:59Z`;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  const { bundle, issues } = await getFhirBundleFromGoogleHealthData({
    client,
    types: [...SYNC_TYPES],
    start_date: startIso,
    end_date: endIso,
    timeZone,
    subjectKey: connection?.subjectKey ?? userId,
  });

  if (issues?.issue?.length) {
    console.warn(
      "[google-health] partial sync issues",
      issues.issue.map((i) => i.diagnostics ?? i.code).join("; "),
    );
  }

  await persistRefreshedCredentials(userId, client);

  const summary = buildGoogleHealthSummary(bundle, { startDate, endDate });

  await database().googleHealthConnection.update({
    where: { userId },
    data: { lastSyncAt: new Date() },
  });

  await database().googleHealthSnapshot.create({
    data: {
      userId,
      startDate,
      endDate,
      summary,
      fhirBundle: bundle as object,
    },
  });

  return summary;
};

export const getLatestGoogleHealthSummary = async (
  userId: string,
): Promise<GoogleHealthSummary | null> => {
  const snap = await database().googleHealthSnapshot.findFirst({
    where: { userId },
    orderBy: { syncedAt: "desc" },
    select: { summary: true },
  });

  if (!snap) return null;
  return snap.summary as unknown as GoogleHealthSummary;
};

export const getGoogleHealthConnectionStatus = async (userId: string) => {
  const connection = await database().googleHealthConnection.findUnique({
    where: { userId },
    select: { linkedAt: true, lastSyncAt: true },
  });

  return {
    configured: googleHealthEnv() !== null,
    connected: connection !== null,
    linkedAt: connection?.linkedAt?.toISOString() ?? null,
    lastSyncAt: connection?.lastSyncAt?.toISOString() ?? null,
  };
};

export const disconnectGoogleHealth = async (userId: string) => {
  await database().googleHealthConnection.deleteMany({ where: { userId } });
};
