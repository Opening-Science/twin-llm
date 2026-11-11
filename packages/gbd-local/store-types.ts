/**
 * Types and the batch size of the local GBD store, apart from `store.ts`
 * (server only), so the import code and its tests can use them.
 */

export type GbdImportOutcome =
  | Readonly<{ kind: "already-imported"; sha256: string }>
  | Readonly<{ kind: "imported"; sha256: string; rowCount: number; newRows: number }>;

/** Rows per write; the store's `addRows` writes any number in batches this size. */
export const GBD_STORE_BATCH = 5_000;

export type GbdImportView = Readonly<{
  sha256: string;
  fileName: string;
  release: string;
  rowCount: number;
  newRows: number;
  /** ISO time. */
  importedAt: string;
  citation: string | null;
  /** Estimates this file has, including ones other files have too (#428). */
  storedRows: number;
}>;
