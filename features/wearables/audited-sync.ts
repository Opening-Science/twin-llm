import type { PersonalRead } from "@/infrastructure/personal-read-audit";

/**
 * One Oura, Whoop or Google Health sync and its audit row (#223): the sync
 * runs, then one `personal.read.sync` row counts the metrics it wrote. Never
 * a value. The sync route and the first sync after an OAuth callback both go
 * through here, so neither writes a snapshot without a row.
 *
 * The snapshot is written inside the sync, before the row; when the row
 * cannot be written this rejects, so the caller reports a failed sync.
 */

export type SyncedMetrics = Readonly<{ metrics: readonly unknown[] }>;

export const syncThenAudit = async <T extends SyncedMetrics>(
  run: () => Promise<T>,
  actor: string,
  audit: (read: PersonalRead) => Promise<unknown>,
): Promise<T> => {
  const synced = await run();
  await audit({ actor, purpose: "sync", rowCount: synced.metrics.length });
  return synced;
};
