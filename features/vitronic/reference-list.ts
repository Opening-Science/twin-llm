/**
 * The reference-scan list (#614, docs/vitronic-reference-scans.md): one row
 * per stored scan of every consented subject other than Self, identifiers
 * only. No measure value, mesh byte or consent note is read, and markers are
 * only checked for presence. The list is written next to the meshes, in the
 * folder git ignores; it is never printed, so a terminal or a log holds
 * counts only.
 */
import "server-only";

import { join } from "node:path";

import type { AppendInput, AppendedEvent } from "@/packages/audit/append";
import { append } from "@/packages/audit/append";
import { database } from "@/infrastructure/database";
import { cipherForUser } from "@/infrastructure/field-cipher-runtime";
import type { FieldCipher } from "@/infrastructure/field-cipher";
import { meshFileName } from "@/infrastructure/mesh-files";

export const VITRONIC_REFERENCE_LIST_AUDIT_TOOL = "vitronic.reference.list";

export type ReferenceSubject = Readonly<{
  id: string;
  label: string;
  consentRecordedAt: Date;
  consentBy: string;
  createdAt: Date;
}>;

export type ReferenceSnapshot = Readonly<{
  subjectId: string;
  viatarId: number;
  presetName: string | null;
  glbSha256: string | null;
  hasMarkers: boolean;
  syncedAt: Date;
}>;

export type ReferenceRow = Readonly<{
  reference: string;
  subjectLabel: string;
  consentRecordedAt: string;
  consentBy: string;
  viatarId: number;
  syncedAt: string;
  preset: string;
  repeat: number;
  glbSha256: string;
  complete: boolean;
}>;

export const REFERENCE_COLUMNS = [
  "reference",
  "subject_label",
  "consent_recorded_at",
  "consent_by",
  "viatar_id",
  "synced_at",
  "preset",
  "repeat",
  "glb_sha256",
  "complete",
  "note",
] as const;

/**
 * Subjects in the order they were created, each one's scans by scan number;
 * `repeat` counts a subject's scans from 1 and `reference` runs across the
 * whole list (R01, R02, …). A scan is complete with both a mesh and markers,
 * as the Body twin's scan list says.
 */
export const referenceRows = (
  subjects: readonly ReferenceSubject[],
  snapshots: readonly ReferenceSnapshot[],
): readonly ReferenceRow[] => {
  const ordered = [...subjects].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );
  const rows: ReferenceRow[] = [];
  for (const subject of ordered) {
    const scans = snapshots
      .filter((scan) => scan.subjectId === subject.id)
      .sort((a, b) => a.viatarId - b.viatarId);
    scans.forEach((scan, index) => {
      rows.push({
        reference: `R${String(rows.length + 1).padStart(2, "0")}`,
        subjectLabel: subject.label,
        consentRecordedAt: subject.consentRecordedAt.toISOString(),
        consentBy: subject.consentBy,
        viatarId: scan.viatarId,
        syncedAt: scan.syncedAt.toISOString(),
        preset: scan.presetName ?? "",
        repeat: index + 1,
        glbSha256: scan.glbSha256 ?? "",
        complete: Boolean(scan.glbSha256) && scan.hasMarkers,
      });
    });
  }
  return rows;
};

/** RFC 4180: a field with a comma, quote or line break is quoted, quotes doubled. */
const csvField = (value: string | number | boolean): string => {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/** The list as CSV, with an empty `note` column for the operator. */
export const referenceCsv = (rows: readonly ReferenceRow[]): string =>
  [
    REFERENCE_COLUMNS.join(","),
    ...rows.map((row) =>
      [
        row.reference,
        row.subjectLabel,
        row.consentRecordedAt,
        row.consentBy,
        row.viatarId,
        row.syncedAt,
        row.preset,
        row.repeat,
        row.glbSha256,
        row.complete,
        "",
      ]
        .map(csvField)
        .join(","),
    ),
  ].join("\n") + "\n";

type ReferenceDb = Readonly<{
  vitronicSubject: {
    findMany: (args: unknown) => Promise<
      ReadonlyArray<
        Readonly<{
          id: string;
          label: string;
          consentRecordedAt: Date;
          consentBy: string;
          createdAt: Date;
        }>
      >
    >;
  };
  vitronicSnapshot: {
    findMany: (args: unknown) => Promise<
      ReadonlyArray<
        Readonly<{
          subjectId: string;
          viatarId: number;
          presetName: string | null;
          glbSha256: string | null;
          markers: string | null;
          syncedAt: Date;
        }>
      >
    >;
  };
}>;

export type ReferenceListPorts = Readonly<{
  database: () => ReferenceDb;
  cipher: (userId: string) => Promise<FieldCipher>;
  append: (input: AppendInput) => Promise<AppendedEvent>;
}>;

const defaultPorts = (): ReferenceListPorts => ({
  database: () => database() as unknown as ReferenceDb,
  cipher: cipherForUser,
  append: (input) => append(database(), input),
});

/**
 * Reads the list for one user: every subject but Self, with its stored scans.
 * One audit row, counts only, written before the rows are returned.
 */
export const listReferenceScans = async (params: {
  readonly userId: string;
  readonly actor: string;
  readonly ports?: Partial<ReferenceListPorts>;
}): Promise<readonly ReferenceRow[]> => {
  const ports = { ...defaultPorts(), ...params.ports };
  const subjects = await ports.database().vitronicSubject.findMany({
    where: { userId: params.userId, isSelf: false },
    select: {
      id: true,
      label: true,
      consentRecordedAt: true,
      consentBy: true,
      createdAt: true,
    },
  });
  const snapshots = await ports.database().vitronicSnapshot.findMany({
    where: { userId: params.userId, subjectId: { in: subjects.map((row) => row.id) } },
    select: {
      subjectId: true,
      viatarId: true,
      presetName: true,
      glbSha256: true,
      markers: true,
      syncedAt: true,
    },
  });
  const cipher = await ports.cipher(params.userId);
  const rows = referenceRows(
    subjects.map((row) => ({
      ...row,
      label: cipher.openText("vitronic_subjects", "label", row.id, row.label),
    })),
    snapshots.map(({ markers, ...row }) => ({ ...row, hasMarkers: markers !== null })),
  );
  await ports.append({
    actor: params.actor,
    sessionId: params.userId,
    subjectRef: null,
    tool: VITRONIC_REFERENCE_LIST_AUDIT_TOOL,
    args: { subjects: subjects.length },
    result: { scans: rows.length },
    rowCount: rows.length,
  });
  return rows;
};

/**
 * The references whose mesh is not on disk. A mesh is stored under its
 * plaintext SHA-256 in the user's folder, as `<sha>.glb` in a synthetic
 * install or `<sha>.glb.enc` once sealed in personal mode (#141); either
 * counts. A row with no mesh hash is incomplete already and is not checked.
 */
export const missingMeshes = async (
  rows: readonly ReferenceRow[],
  userDir: string,
  exists: (path: string) => Promise<boolean>,
): Promise<readonly string[]> => {
  const missing: string[] = [];
  for (const row of rows) {
    if (!row.glbSha256) continue;
    const plain = join(userDir, meshFileName(row.glbSha256, false));
    const sealed = join(userDir, meshFileName(row.glbSha256, true));
    if (!(await exists(plain)) && !(await exists(sealed))) missing.push(row.reference);
  }
  return missing;
};
