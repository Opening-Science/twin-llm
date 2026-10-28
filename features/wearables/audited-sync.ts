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
 */

export type SyncedProvider = "oura" | "whoop" | "google-health";

export const syncPurpose = (provider: SyncedProvider) => `sync-${provider}` as const;

export type SyncedMetrics = Readonly<{ metrics: readonly unknown[] }>;

/** A fetched sync that is not stored yet: what it read, and the step that stores it. */
export type PreparedSync<T extends SyncedMetrics> = Readonly<{
  synced: T;
  save: () => Promise<void>;
}>;

export const auditThenSave = async <T extends SyncedMetrics>(
  prepare: () => Promise<PreparedSync<T>>,
  provider: SyncedProvider,
  actor: string,
  audit: (read: PersonalRead) => Promise<unknown>,
): Promise<T> => {
  const { synced, save } = await prepare();
  await audit({ actor, purpose: syncPurpose(provider), rowCount: synced.metrics.length });
  await save();
  return synced;
};
