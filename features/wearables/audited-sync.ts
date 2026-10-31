import { CATEGORY, type Disclosure } from "@/infrastructure/disclosure-ledger";
import type { PersonalRead } from "@/infrastructure/personal-read-audit";

/**
 * One Oura, Whoop or Google Health sync and its audit row (#223, #235): the
 * sync fetches, then one `personal.read.sync-<provider>` row counts the
 * metrics about to be stored, then the snapshot is saved. Never a value. The
 * provider is in the tool name, since args are stored only as a hash. The
 * sync route and the first sync after an OAuth callback both go through here.
 *
 * The row comes before the save, so no snapshot is ever stored without one.
 * When the row cannot be written nothing is saved and this rejects, so the
 * caller reports a failed sync. When the save fails after the row, the row
 * stands for a sync that stored nothing; that errs on the side of logging.
 *
 * Before the fetch, `disclose` writes the request to the disclosure ledger
 * (#140, `vendorSyncDisclosure`): the vendor gets the person's access token
 * (refreshed when due) and the date window, never a health value. When that
 * write fails nothing is fetched and this rejects.
 */

export type SyncedProvider = "oura" | "whoop" | "google-health";

export const syncPurpose = (provider: SyncedProvider) => `sync-${provider}` as const;

export type SyncedMetrics = Readonly<{ metrics: readonly unknown[] }>;

/** A fetched sync that is not stored yet: what it read, and the step that stores it. */
export type PreparedSync<T extends SyncedMetrics> = Readonly<{
  synced: T;
  save: () => Promise<void>;
}>;

const VENDOR_NAMES: Readonly<Record<SyncedProvider, string>> = {
  oura: "Oura",
  whoop: "Whoop",
  "google-health": "Google Health",
};

/** One sync's request to the vendor: the token and the date window. */
export const vendorSyncDisclosure = (
  provider: SyncedProvider,
  actor: string,
  options: Readonly<{ sandbox?: boolean }> = {},
): Disclosure => ({
  actor,
  sessionId: syncPurpose(provider),
  kind: "vendor-sync",
  recipient: VENDOR_NAMES[provider],
  target: options.sandbox === true ? "sandbox data download" : "data download",
  purpose: "sync",
  categories: [CATEGORY.accessToken, CATEGORY.dateWindow],
  refs: [],
  payloadBytes: null,
  threadId: null,
  synthetic: options.sandbox === true,
});

/** The OAuth return's code exchange: the authorization code and the app's credentials. */
export const vendorAuthDisclosure = (
  provider: SyncedProvider,
  actor: string,
): Disclosure => ({
  actor,
  sessionId: `connect-${provider}`,
  kind: "vendor-auth",
  recipient: VENDOR_NAMES[provider],
  target: "token exchange",
  purpose: "connect",
  categories: [CATEGORY.authCode],
  refs: [],
  payloadBytes: null,
  threadId: null,
  synthetic: false,
});

export const auditThenSave = async <T extends SyncedMetrics>(
  prepare: () => Promise<PreparedSync<T>>,
  provider: SyncedProvider,
  actor: string,
  audit: (read: PersonalRead) => Promise<unknown>,
  disclose: () => Promise<unknown>,
): Promise<T> => {
  await disclose();
  const { synced, save } = await prepare();
  await audit({ actor, purpose: syncPurpose(provider), rowCount: synced.metrics.length });
  await save();
  return synced;
};
