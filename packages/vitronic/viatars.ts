/**
 * Pick the newest Viatar whose integer scan key matches. key_external is not queryable.
 */

export type VitronicViatar = Readonly<{
  viatar_id: number;
  proband_id?: number | null;
  key_external?: string | null;
  note?: string | null;
  preset?: string | null;
  parameters?: unknown;
  meta?: { readonly crtime?: string | null; readonly mtime?: string | null } | null;
}>;

export type ScanSyncState = "missing" | "incomplete" | "complete";

export type VitronicScanRef = Readonly<{
  viatarId: number;
  crtime: string | null;
  synced: boolean;
  incomplete: boolean;
  presetName: string | null;
}>;

export type SnapshotSyncFacts = Readonly<{
  viatarId: number;
  glbSha256?: string | null;
  hasAvatar?: boolean;
  markers: unknown;
  measures?: unknown;
  properties?: readonly unknown[];
  presetName: string | null;
  crtime?: string | null;
}>;

export const presetNameFromViatar = (row: VitronicViatar): string | null => {
  if (typeof row.preset === "string" && row.preset.trim().length > 0) {
    return row.preset.trim();
  }
  const params = row.parameters;
  if (params && typeof params === "object" && !Array.isArray(params)) {
    for (const value of Object.values(params as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const preset = (value as { preset?: unknown }).preset;
      if (typeof preset === "string" && preset.trim().length > 0) return preset.trim();
    }
  }
  return null;
};

export const viatarsForProbandId = (
  listed: readonly VitronicViatar[],
  probandId: number,
): readonly VitronicViatar[] => listed.filter((row) => row.proband_id === probandId);

const hasGlb = (snapshot: SnapshotSyncFacts): boolean => {
  if (snapshot.hasAvatar === true) return true;
  return typeof snapshot.glbSha256 === "string" && snapshot.glbSha256.length > 0;
};

const hasFileMeasurements = (snapshot: SnapshotSyncFacts): boolean => {
  if (Array.isArray(snapshot.measures) && snapshot.measures.length > 0) return true;
  if (Array.isArray(snapshot.properties) && snapshot.properties.length > 0) return true;
  if (Array.isArray(snapshot.markers) && snapshot.markers.length > 0) return true;
  return false;
};

/** Scanner: glb + markers column present (empty array counts). File: glb or measurements. */
export const scanSyncState = (params: {
  readonly subjectKind: "scanner" | "file";
  readonly snapshot: SnapshotSyncFacts | null;
}): ScanSyncState => {
  if (!params.snapshot) return "missing";
  const mesh = hasGlb(params.snapshot);
  if (params.subjectKind === "file") {
    if (mesh || hasFileMeasurements(params.snapshot)) return "complete";
    return "incomplete";
  }
  if (mesh && params.snapshot.markers != null) return "complete";
  return "incomplete";
};

export const scanRefFromState = (params: {
  readonly viatarId: number;
  readonly crtime: string | null;
  readonly presetName: string | null;
  readonly state: ScanSyncState;
}): VitronicScanRef => ({
  viatarId: params.viatarId,
  crtime: params.crtime,
  synced: params.state === "complete",
  incomplete: params.state === "incomplete",
  presetName: params.presetName,
});

export const scanRefsForViatars = (
  listed: readonly VitronicViatar[],
  storedByViatar: ReadonlyMap<number, SnapshotSyncFacts> = new Map(),
  subjectKind: "scanner" | "file" = "scanner",
): readonly VitronicScanRef[] =>
  listed.map((row) => {
    const stored = storedByViatar.get(row.viatar_id) ?? null;
    return scanRefFromState({
      viatarId: row.viatar_id,
      crtime: row.meta?.crtime ?? null,
      presetName: stored?.presetName ?? presetNameFromViatar(row),
      state: scanSyncState({ subjectKind, snapshot: stored }),
    });
  });

/** File-only (or offline) snapshots that never appeared on GET /viatars/. */
export const mergeStoredScanRefs = (
  live: readonly VitronicScanRef[],
  stored: readonly SnapshotSyncFacts[],
  subjectKind: "scanner" | "file" = "file",
): readonly VitronicScanRef[] => {
  const listedIds = new Set(live.map((row) => row.viatarId));
  const extras = stored
    .filter((row) => !listedIds.has(row.viatarId))
    .map((row) =>
      scanRefFromState({
        viatarId: row.viatarId,
        crtime: row.crtime ?? null,
        presetName: row.presetName,
        state: scanSyncState({ subjectKind, snapshot: row }),
      }),
    );
  return [...live, ...extras];
};

export const newestViatarForProbandId = (
  listed: readonly VitronicViatar[],
  probandId: number,
): VitronicViatar | undefined => {
  const matches = viatarsForProbandId(listed, probandId);
  if (matches.length === 0) return undefined;
  return [...matches].sort((a, b) => {
    const ta = Date.parse(a.meta?.crtime ?? "") || 0;
    const tb = Date.parse(b.meta?.crtime ?? "") || 0;
    if (ta !== tb) return tb - ta;
    return b.viatar_id - a.viatar_id;
  })[0];
};
