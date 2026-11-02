import { formatNumber } from "@/infrastructure/format-measure";
import type { LatticeState } from "@/infrastructure/ui-kit/status-lattice-model";
import { GBD_CITATION_FILE } from "@/packages/gbd-local/citation";
import type { GbdCsvError } from "@/packages/gbd-local/results-csv";
import type { GbdImportView } from "@/packages/gbd-local/store-types";

/** What the GBD import on Customize · Data shows, as pure functions (#426). */

export type GbdUploadStatus =
  | Readonly<{ phase: "waiting" }>
  | Readonly<{ phase: "sending"; percent: number }>
  | Readonly<{ phase: "reading"; rows: number }>
  | Readonly<{ phase: "imported"; rowCount: number; newRows: number }>
  | Readonly<{ phase: "skipped" }>
  | Readonly<{ phase: "refused"; error: GbdCsvError }>
  | Readonly<{ phase: "failed"; message: string; code?: string }>;

const count = (value: number, one: string, many: string): string =>
  `${formatNumber(value, 0)} ${value === 1 ? one : many}`;

export const gbdLatticeState = (status: GbdUploadStatus): LatticeState =>
  status.phase === "imported" || status.phase === "skipped"
    ? "done"
    : status.phase === "refused" || status.phase === "failed"
      ? "error"
      : "working";

/** The refusal as the importer words it, with its code, line and missing columns. */
export const gbdRefusalText = (error: GbdCsvError): string => {
  const where = error.line === undefined ? "" : `, line ${formatNumber(error.line, 0)}`;
  const missing =
    error.missing === undefined || error.missing.length === 0
      ? ""
      : ` Missing columns: ${error.missing.join(", ")}.`;
  return `${error.message}${missing} (${error.code}${where})`;
};

export const gbdStatusText = (status: GbdUploadStatus): string => {
  switch (status.phase) {
    case "waiting":
      return "Waiting";
    case "sending":
      return `Sending, ${formatNumber(status.percent, 0)}%`;
    case "reading":
      return `Reading, ${count(status.rows, "row", "rows")} so far`;
    case "imported":
      return `${count(status.rowCount, "row", "rows")}, ${formatNumber(status.newRows, 0)} new`;
    case "skipped":
      return "Already imported, skipped";
    case "refused":
      return gbdRefusalText(status.error);
    case "failed":
      return status.code === undefined
        ? status.message
        : `${status.message} (${status.code})`;
  }
};

/** The CSV files of a selection, and the download's citation.txt when it is in it. */
export const splitGbdSelection = <T extends Readonly<{ name: string }>>(
  files: readonly T[],
): Readonly<{ csv: readonly T[]; citation: T | null; other: readonly T[] }> => ({
  csv: files.filter((file) => /\.csv$/i.test(file.name)),
  citation: files.find((file) => file.name.toLowerCase() === GBD_CITATION_FILE) ?? null,
  other: files.filter(
    (file) => !/\.csv$/i.test(file.name) && file.name.toLowerCase() !== GBD_CITATION_FILE,
  ),
});

/** "1,234 rows, 1,200 new when imported, 1,200 held now" for one file. */
export const gbdImportCountsLabel = (view: GbdImportView): string =>
  `${count(view.rowCount, "row", "rows")}, ${formatNumber(view.newRows, 0)} new when imported, ${formatNumber(view.storedRows, 0)} held now`;

/** The day a file was imported, as YYYY-MM-DD. */
export const gbdImportedOn = (view: GbdImportView): string =>
  view.importedAt.slice(0, 10);
