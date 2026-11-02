import type { AppendInput } from "@/packages/audit/append";

/**
 * Audit rows of the GBD import on Customize · Data (#426). Pure builders.
 * The rows hold byte sizes, the file's SHA-256, row counts and the refusal
 * code: never an estimate, a file name or the citation. GBD results are
 * population data, not personal data; the rows say who changed what the
 * chat can cite.
 */

export const GBD_IMPORT_AUDIT = {
  import: "gbd.import",
  delete: "gbd.delete",
} as const;

export type GbdAuditContext = Readonly<{ actor: string; sessionId: string }>;

export type GbdImportAuditOutcome =
  | Readonly<{ kind: "imported"; rows: number; newRows: number }>
  | Readonly<{ kind: "already-imported" }>
  | Readonly<{ kind: "refused"; code: string }>;

export const gbdImportEvent = (
  context: GbdAuditContext,
  file: Readonly<{ bytes: number; sha256: string | null }>,
  outcome: GbdImportAuditOutcome,
): AppendInput => ({
  actor: context.actor,
  sessionId: context.sessionId,
  subjectRef: null,
  tool: GBD_IMPORT_AUDIT.import,
  args: { bytes: file.bytes, sha256: file.sha256 },
  result:
    outcome.kind === "imported"
      ? { stored: true, rows: outcome.rows, new_rows: outcome.newRows }
      : outcome.kind === "already-imported"
        ? { stored: false, skipped: "already-imported" }
        : { stored: false, refused: outcome.code },
  rowCount: outcome.kind === "imported" ? outcome.newRows : 0,
});

export const gbdDeleteEvent = (
  context: GbdAuditContext,
  sha256: string,
  rowsDeleted: number | null,
): AppendInput => ({
  actor: context.actor,
  sessionId: context.sessionId,
  subjectRef: null,
  tool: GBD_IMPORT_AUDIT.delete,
  args: { sha256 },
  result: { found: rowsDeleted !== null, rows_deleted: rowsDeleted ?? 0 },
  rowCount: rowsDeleted ?? 0,
});
