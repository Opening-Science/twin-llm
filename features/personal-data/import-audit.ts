import type { AppendInput } from "@/packages/audit/append";
import { type ImportKind, isGenomeImportKind } from "@/packages/personal-data/types";

/**
 * Audit rows for imported personal data. Pure builders, so a test can check
 * every field: kinds, ids, counts, byte sizes and the file's SHA-256 only.
 * Never a value, a unit, a code, a test or column name, a dataset name or a
 * file name, and never a hash of any of those (a short value is easy to
 * recover from its hash by trying them all). The file's own SHA-256 covers
 * the whole file, so it says nothing about any one value.
 *
 * A genome VCF's rows carry no SHA-256 either: a small VCF is a known header
 * and a handful of genotypes, few enough to recover from the file's hash by
 * trying them all. Its rows hold the kind, byte size and counts only.
 */

export const PERSONAL_DATA_AUDIT = {
  review: "personal-data.review",
  save: "personal-data.save",
  list: "personal-data.list",
  rename: "personal-data.rename",
  delete: "personal-data.delete",
} as const;

export type AuditContext = Readonly<{ actor: string; sessionId: string }>;

type AuditedFile = Readonly<{
  kind: ImportKind | null;
  byteSize: number;
  sha256: string | null;
}>;

/** The file facts a row may hold: no SHA-256 for a genome file. */
export const fileArgs = (
  file: AuditedFile,
): Readonly<{ kind: ImportKind | null; bytes: number; sha256: string | null }> => ({
  kind: file.kind,
  bytes: file.byteSize,
  sha256: file.kind !== null && isGenomeImportKind(file.kind) ? null : file.sha256,
});

const event = (
  context: AuditContext,
  tool: string,
  args: Readonly<Record<string, string | number | null>>,
  result: Readonly<Record<string, string | number | boolean | null>>,
  rowCount: number,
): AppendInput => ({
  actor: context.actor,
  sessionId: context.sessionId,
  subjectRef: null,
  tool,
  args,
  result,
  rowCount,
});

export type ReviewCounts = Readonly<{ rowsToStore: number; unmapped: number }>;

/** A parse for review: stored nothing. `refused` names why the file was refused. */
export const reviewEvent = (
  context: AuditContext,
  file: AuditedFile,
  outcome: Readonly<{ refused: string } | ReviewCounts>,
): AppendInput =>
  event(
    context,
    PERSONAL_DATA_AUDIT.review,
    fileArgs(file),
    "refused" in outcome
      ? { stored: false, refused: outcome.refused }
      : { stored: false, rows: outcome.rowsToStore, unmapped: outcome.unmapped },
    0,
  );

export const saveEvent = (
  context: AuditContext,
  file: AuditedFile,
  outcome: Readonly<
    { refused: string } | { datasetId: string; rows: number; unmapped: number }
  >,
): AppendInput =>
  "refused" in outcome
    ? event(
        context,
        PERSONAL_DATA_AUDIT.save,
        fileArgs(file),
        { stored: false, refused: outcome.refused },
        0,
      )
    : event(
        context,
        PERSONAL_DATA_AUDIT.save,
        fileArgs(file),
        {
          stored: true,
          dataset_id: outcome.datasetId,
          rows: outcome.rows,
          unmapped: outcome.unmapped,
        },
        outcome.rows,
      );

/** The page read the person's dataset list: ids and counts, no rows. */
export const listEvent = (
  context: AuditContext,
  datasets: readonly Readonly<{ id: string; rowCount: number }>[],
): AppendInput =>
  event(
    context,
    PERSONAL_DATA_AUDIT.list,
    {},
    { datasets: datasets.length },
    datasets.length,
  );

export const renameEvent = (
  context: AuditContext,
  datasetId: string,
  found: boolean,
): AppendInput =>
  event(context, PERSONAL_DATA_AUDIT.rename, { dataset_id: datasetId }, { found }, 0);

export const deleteEvent = (
  context: AuditContext,
  datasetId: string,
  rowsDeleted: number | null,
): AppendInput =>
  event(
    context,
    PERSONAL_DATA_AUDIT.delete,
    { dataset_id: datasetId },
    { found: rowsDeleted !== null, rows_deleted: rowsDeleted ?? 0 },
    rowsDeleted ?? 0,
  );
