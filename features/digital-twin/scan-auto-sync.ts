/**
 * New scanner scans sync themselves when the Body twin opens (#613): the scan
 * list already asks the scanner which scans exist, so a scan it lists that
 * was never stored is fetched without a press. A scan stored incomplete (the
 * scanner was still building its mesh) is fetched again while it is under an
 * hour old; an older incomplete one keeps its Sync again button, so a scan
 * that never finishes is not fetched on every open.
 */
import type { BodyTwinScan } from "./body-twin-types";

/** At most this many per open, so a long backlog does not hold the page. */
export const AUTO_SYNC_LIMIT = 3;

/** How long an incomplete scan is still worth fetching again on its own. */
export const AUTO_RESYNC_WINDOW_MS = 60 * 60 * 1000;

const timeOf = (scan: BodyTwinScan): number => Date.parse(scan.crtime ?? "") || 0;

const wanted = (scan: BodyTwinScan, now: number): boolean => {
  if (scan.synced === true) return false;
  if (scan.incomplete !== true) return true;
  const at = timeOf(scan);
  return at > 0 && now - at >= 0 && now - at < AUTO_RESYNC_WINDOW_MS;
};

/** The scans to fetch now, newest first. */
export const scansToAutoSync = (
  scans: readonly BodyTwinScan[],
  now: number,
  limit: number = AUTO_SYNC_LIMIT,
): readonly number[] =>
  scans
    .filter((scan) => wanted(scan, now))
    .sort((a, b) => timeOf(b) - timeOf(a) || b.viatarId - a.viatarId)
    .slice(0, limit)
    .map((scan) => scan.viatarId);

export type AutoSyncOutcome = Readonly<{
  synced: readonly number[];
  /** True when a sync failed; the rest were not tried. */
  stopped: boolean;
}>;

/**
 * Syncs the scans one by one through the subject's own sync route and stops
 * at the first failure: a scanner that fails once is usually gone, and the
 * scans left keep their Sync button. Once `cancelled` says so (another
 * subject was picked, or the page closed) no further scan is asked for.
 */
export const autoSyncScans = async (
  viatarIds: readonly number[],
  syncOne: (viatarId: number) => Promise<boolean>,
  cancelled: () => boolean = () => false,
): Promise<AutoSyncOutcome> => {
  const synced: number[] = [];
  for (const viatarId of viatarIds) {
    if (cancelled()) return { synced, stopped: false };
    const ok = await syncOne(viatarId).catch(() => false);
    if (!ok) return { synced, stopped: true };
    synced.push(viatarId);
  }
  return { synced, stopped: false };
};
