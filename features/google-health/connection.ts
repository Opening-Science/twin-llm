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

import { openToken, sealToken } from "@/infrastructure/connector-tokens";
import { database } from "@/infrastructure/database";
import {
  type FieldCipher,
  newRowId,
  openJson,
  sealJson,
  sealNullableJson,
} from "@/infrastructure/field-cipher";
import { cipherForUser } from "@/infrastructure/field-cipher-runtime";
import { googleHealthEnv } from "@/infrastructure/env";
import {
  getGoogleHealthCredentials,
  setGoogleHealthCredentials,
} from "@/infrastructure/open-twin-adapters/google-health";

import type { PreparedSync } from "@/features/wearables/audited-sync";
import { resolveSyncDateWindow } from "@/features/wearables/sync-window";

import { buildGoogleHealthSummary, type GoogleHealthSummary } from "./summary";
import { decryptGoogleHealthSecret, encryptGoogleHealthSecret } from "./token-crypto";

const TABLE = "google_health_connections";

/** The env-key ciphertext of both tokens, sealed for one row with the owner's keys (#341). */
const sealedTokens = (
  cipher: FieldCipher,
  rowId: string,
  tokens: Readonly<{ access_token: string; refresh_token: string }>,
) => ({
  accessTokenEnc: sealToken(
    cipher,
    TABLE,
    "accessTokenEnc",
    rowId,
    encryptGoogleHealthSecret(tokens.access_token),
  ),
  refreshTokenEnc: sealToken(
    cipher,
    TABLE,
    "refreshTokenEnc",
    rowId,
    encryptGoogleHealthSecret(tokens.refresh_token),
  ),
});

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

  // Sealed with the owner's keys (#341); nothing is stored while locked.
  const cipher = await cipherForUser(params.userId);
  const existing = await database().googleHealthConnection.findUnique({
    where: { userId: params.userId },
    select: { id: true },
  });
  const id = existing?.id ?? newRowId();
  const data = {
    ...sealedTokens(cipher, id, {
      access_token: params.tokens.access_token,
      refresh_token: params.tokens.refresh_token,
    }),
    accessTokenExpiresAt: toExpiry(params.tokens),
    ...(params.subjectKey ? { subjectKey: params.subjectKey } : {}),
  };

  await database().googleHealthConnection.upsert({
    where: { userId: params.userId },
    create: { id, userId: params.userId, ...data },
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

  // Tokens open only with the owner's unlocked vault (#341); locked, this throws.
  const cipher = await cipherForUser(userId);
  const open = (column: "accessTokenEnc" | "refreshTokenEnc") =>
    decryptGoogleHealthSecret(
      openToken(cipher, TABLE, column, connection.id, connection[column]),
    );
  const client = new GoogleHealthClient(config);
  setGoogleHealthCredentials(client, {
    access_token: open("accessTokenEnc"),
    refresh_token: open("refreshTokenEnc"),
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

  const cipher = await cipherForUser(userId);
  const connection = await database().googleHealthConnection.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!connection) return;
  await database().googleHealthConnection.update({
    where: { userId },
    data: {
      ...sealedTokens(cipher, connection.id, {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
      }),
      accessTokenExpiresAt: toExpiry(tokens),
    },
  });
};

/**
 * Fetches one Google Health sync and returns the summary with the step that
 * stores it. Refreshed credentials are stored at once; the snapshot and
 * `lastSyncAt` only when `save` runs, which `auditThenSave` does after the
 * audit row.
 */
export const syncGoogleHealthForUser = async (
  userId: string,
  options?: { readonly startDate?: string; readonly endDate?: string },
): Promise<PreparedSync<GoogleHealthSummary>> => {
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

  const save = async () => {
    await database().googleHealthConnection.update({
      where: { userId },
      data: { lastSyncAt: new Date() },
    });

    // Sealed with the person's keys (#141); refused while their vault is locked.
    const cipher = await cipherForUser(userId);
    const id = crypto.randomUUID();
    await database().googleHealthSnapshot.create({
      data: {
        id,
        userId,
        startDate,
        endDate,
        summary: sealJson(cipher, "google_health_snapshots", "summary", id, summary),
        fhirBundle: sealNullableJson(
          cipher,
          "google_health_snapshots",
          "fhirBundle",
          id,
          bundle ?? null,
        ),
      },
    });
  };

  return { synced: summary, save };
};

export const getLatestGoogleHealthSummary = async (
  userId: string,
  ports?: { readonly cipher?: (userId: string) => Promise<FieldCipher> },
): Promise<GoogleHealthSummary | null> => {
  const snap = await database().googleHealthSnapshot.findFirst({
    where: { userId },
    orderBy: { syncedAt: "desc" },
    select: { id: true, summary: true },
  });

  if (!snap) return null;
  return openJson(
    await (ports?.cipher ?? cipherForUser)(userId),
    "google_health_snapshots",
    "summary",
    snap.id,
    snap.summary,
  ) as GoogleHealthSummary;
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
