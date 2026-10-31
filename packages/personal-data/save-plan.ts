import { CHUNK_ROWS, MAX_NAME_LENGTH } from "./limits";
import { dateRangeOf } from "./review-summary";
import type {
  ClinicalDraft,
  ImportKind,
  ObservationDraft,
  ParsedOk,
  TableCell,
  TableColumn,
  VariantDraft,
} from "./types";

/**
 * Exactly what Save writes for one import, worked out before any write.
 * Pure, so tests check the rows without a database; the store writes the
 * plan in one transaction, so a dataset is stored whole or not at all.
 */

export type SavePlan = Readonly<{
  dataset: Readonly<{
    userId: string;
    kind: ImportKind;
    name: string;
    sourceFileName: string;
    sha256: string;
    byteSize: number;
    rowCount: number;
    firstAt: string | null;
    lastAt: string | null;
    /** "GRCh38" for a VCF; null for every other format. */
    genomeBuild: string | null;
  }>;
  observations: readonly ObservationDraft[];
  clinical: readonly ClinicalDraft[];
  table: Readonly<{ columns: readonly TableColumn[]; rowCount: number }> | null;
  /** Table rows in chunks of `CHUNK_ROWS`, in file order. */
  chunks: readonly (readonly (readonly TableCell[])[])[];
  /** A VCF's records, in file order. */
  variants: readonly VariantDraft[];
}>;

// Control characters (C0 and DEL) never belong in a name shown on a page.
const CONTROL = /[\u0000-\u001f\u007f]+/g;

/** A name as typed: control characters out, spaces collapsed, at most 120 characters. */
export const cleanDatasetName = (raw: string): string =>
  raw.replace(CONTROL, " ").replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);

/** The file's name without folders or extension, as the default dataset name. */
export const defaultDatasetName = (fileName: string): string => {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return cleanDatasetName(stem) || "Imported data";
};

export const chunkRows = <T>(rows: readonly T[], size: number = CHUNK_ROWS): T[][] =>
  Array.from({ length: Math.ceil(rows.length / size) }, (_, index) =>
    rows.slice(index * size, (index + 1) * size),
  );

export const savePlan = (
  parsed: ParsedOk,
  input: Readonly<{
    userId: string;
    name: string;
    fileName: string;
    sha256: string;
    byteSize: number;
  }>,
): SavePlan => {
  const range = dateRangeOf(parsed);
  const observations =
    parsed.kind === "table" || parsed.kind === "vcf" ? [] : parsed.observations;
  const clinical = parsed.kind === "fhir" ? parsed.clinical : [];
  const tableRows = parsed.kind === "table" ? parsed.table.rows : [];
  const variants = parsed.kind === "vcf" ? parsed.variants : [];
  return {
    dataset: {
      userId: input.userId,
      kind: parsed.kind,
      name: cleanDatasetName(input.name) || defaultDatasetName(input.fileName),
      sourceFileName: cleanDatasetName(input.fileName) || "file",
      sha256: input.sha256,
      byteSize: input.byteSize,
      rowCount:
        observations.length + clinical.length + tableRows.length + variants.length,
      firstAt: range?.first ?? null,
      lastAt: range?.last ?? null,
      genomeBuild: parsed.kind === "vcf" ? parsed.build : null,
    },
    observations,
    clinical,
    table:
      parsed.kind === "table"
        ? { columns: parsed.table.columns, rowCount: tableRows.length }
        : null,
    chunks: chunkRows(tableRows),
    variants,
  };
};
