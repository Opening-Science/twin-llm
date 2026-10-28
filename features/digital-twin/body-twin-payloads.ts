import { SCAN_SYNC_AGAIN, SCAN_DEFAULT_TAG } from "./body-twin-copy";
import {
  type BodyTwinSubject,
  type BodyTwinScan,
  type BodyTwinSnapshot,
} from "./body-twin-types";

/** Shape checks for the BodyLoop API answers the viewer fetches. */
export const scanLabel = (scan: BodyTwinScan, pinnedViatarId: number | null): string => {
  const day = scan.crtime ? scan.crtime.slice(0, 10) : "unknown date";
  const status = scan.incomplete
    ? SCAN_SYNC_AGAIN
    : scan.synced === true
      ? "synced"
      : "not synced";
  const preset = scan.presetName ? ` · ${scan.presetName}` : "";
  const pinned = scan.viatarId === pinnedViatarId ? ` · ${SCAN_DEFAULT_TAG}` : "";
  return `${day} · scan ${scan.viatarId} · ${status}${preset}${pinned}`;
};

export type SubjectsPayload = { readonly subjects?: readonly BodyTwinSubject[] };
export type ScansPayload = { readonly scans?: readonly BodyTwinScan[] };
export type SnapshotsPayload = { readonly snapshots?: readonly BodyTwinSnapshot[] };

export const isSubjectsPayload = (value: unknown): value is SubjectsPayload =>
  Boolean(
    value &&
    typeof value === "object" &&
    Array.isArray((value as SubjectsPayload).subjects),
  );

export const isScansPayload = (value: unknown): value is ScansPayload =>
  Boolean(
    value && typeof value === "object" && Array.isArray((value as ScansPayload).scans),
  );

export const isSnapshotsPayload = (value: unknown): value is SnapshotsPayload =>
  Boolean(
    value &&
    typeof value === "object" &&
    Array.isArray((value as SnapshotsPayload).snapshots),
  );

/**
 * Digital Twin Body twin: subject and scan selectors, GLTFLoader, OrbitControls,
 * Z-up fit, AutoMarkers overlay, scan date and SI property values.
 */
