import type { VitronicPropertyRow } from "@/features/vitronic/vitronic-status-view";

/** What the Body twin viewer reads: subjects, scans, snapshots and a preview. */
export type BodyTwinSubject = Readonly<{
  id: string;
  label: string;
  isSelf: boolean;
  source?: string;
  defaultViatarId?: number | null;
}>;

export type BodyTwinScan = Readonly<{
  viatarId: number;
  crtime: string | null;
  synced?: boolean;
  incomplete?: boolean;
  presetName?: string | null;
}>;

export type BodyTwinSnapshot = Readonly<{
  id: string;
  viatarId: number;
  hasAvatar: boolean;
  presetName?: string | null;
  properties: readonly VitronicPropertyRow[];
  markers?: unknown;
  measures?: unknown;
}>;

export type BodyTwinPreview = Readonly<{
  subjects?: readonly BodyTwinSubject[];
  scans?: readonly BodyTwinScan[];
  snapshots?: readonly BodyTwinSnapshot[];
  selectedSubjectId?: string;
  selectedViatarId?: number;
}>;
