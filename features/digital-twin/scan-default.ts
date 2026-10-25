import { scanSyncState } from "@/packages/vitronic/viatars";

export type ScanListInput = Readonly<{
  viatarId: number;
  crtime: string | null;
  presetName?: string | null;
}>;

export type SnapshotListInput = Readonly<{
  viatarId: number;
  hasAvatar: boolean;
  presetName?: string | null;
  properties: readonly unknown[];
  markers?: unknown;
  measures?: unknown;
}>;

export type ListedScan = Readonly<{
  viatarId: number;
  crtime: string | null;
  synced: boolean;
  incomplete: boolean;
  presetName: string | null;
}>;

/** Live scanner rows joined with stored snapshots, plus stored rows the scanner no longer lists. */
export const mergeScanRows = (
  scans: readonly ScanListInput[],
  snapshots: readonly SnapshotListInput[],
  subjectKind: "scanner" | "file",
): readonly ListedScan[] => {
  const byViatar = new Map(snapshots.map((row) => [row.viatarId, row] as const));
  const live = scans.map((scan) => {
    const snap = byViatar.get(scan.viatarId);
    const state = scanSyncState({
      subjectKind,
      snapshot: snap
        ? {
            viatarId: snap.viatarId,
            hasAvatar: snap.hasAvatar,
            markers: snap.markers,
            measures: snap.measures,
            properties: snap.properties,
            presetName: snap.presetName ?? scan.presetName ?? null,
            crtime: scan.crtime,
          }
        : null,
    });
    return {
      viatarId: scan.viatarId,
      crtime: scan.crtime,
      synced: state === "complete",
      incomplete: state === "incomplete",
      presetName: scan.presetName ?? snap?.presetName ?? null,
    };
  });
  const listedIds = new Set(live.map((row) => row.viatarId));
  const extras = snapshots
    .filter((row) => !listedIds.has(row.viatarId))
    .map((row) => {
      const state = scanSyncState({
        subjectKind,
        snapshot: {
          viatarId: row.viatarId,
          hasAvatar: row.hasAvatar,
          markers: row.markers,
          measures: row.measures,
          properties: row.properties,
          presetName: row.presetName ?? null,
        },
      });
      return {
        viatarId: row.viatarId,
        crtime: null,
        synced: state === "complete",
        incomplete: state === "incomplete",
        presetName: row.presetName ?? null,
      };
    });
  return [...live, ...extras];
};

const syncRank = (row: ListedScan): number => (row.synced ? 0 : row.incomplete ? 1 : 2);

const timeOf = (row: ListedScan): number => Date.parse(row.crtime ?? "") || 0;

/** Synced first, then incomplete, then not synced; newest first within each group. */
export const orderScans = (rows: readonly ListedScan[]): readonly ListedScan[] =>
  [...rows].sort(
    (a, b) =>
      syncRank(a) - syncRank(b) || timeOf(b) - timeOf(a) || b.viatarId - a.viatarId,
  );

/** Pinned scan while it is still synced, else the newest synced scan, else the first row. */
export const pickDefaultScan = (
  rows: readonly ListedScan[],
  pinnedViatarId: number | null,
): number | undefined => {
  const pinned = rows.find((row) => row.viatarId === pinnedViatarId && row.synced);
  if (pinned) return pinned.viatarId;
  const ordered = orderScans(rows);
  return (ordered.find((row) => row.synced) ?? ordered[0])?.viatarId;
};
