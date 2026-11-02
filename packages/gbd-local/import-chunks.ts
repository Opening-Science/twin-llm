import { createHash } from "node:crypto";

import { createGbdCsvReader, type GbdCsvError, type GbdCsvRow } from "./results-csv";
import { GBD_STORE_BATCH, type GbdImportOutcome } from "./store-types";

/**
 * One GBD Results Tool file into the local store, read a chunk at a time
 * (#426). `bun run gbd:import` passes the file's bytes as one chunk;
 * Customize · Data passes chunks of the uploaded file it saved in the state
 * folder. Rows are written in batches as they are read, so a large file is
 * never held whole. A file whose checksum is known is skipped before it is
 * read; a refused file, or a failed write, drops the file's record and every
 * row it brought. The store comes in as ports, so this file does no I/O of
 * its own.
 */

export type GbdImportStore = Readonly<{
  known: (sha256: string) => Promise<boolean>;
  begin: (
    file: Readonly<{ sha256: string; fileName: string; citation?: string }>,
  ) => Promise<void>;
  /** Writes the rows; answers how many were new. */
  addRows: (sha256: string, rows: readonly GbdCsvRow[]) => Promise<number>;
  finish: (
    sha256: string,
    counts: Readonly<{ rowCount: number; newRows: number }>,
  ) => Promise<void>;
  abort: (sha256: string) => Promise<void>;
}>;

export type GbdChunksOutcome =
  GbdImportOutcome | Readonly<{ kind: "refused"; sha256: string; error: GbdCsvError }>;

export type GbdImportProgress = Readonly<{ bytes: number; rows: number }>;

export type GbdChunksFile = Readonly<{
  sha256: string;
  fileName: string;
  citation?: string | null;
}>;

export const sha256Of = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

export const importGbdChunks = async (
  file: GbdChunksFile,
  chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  store: GbdImportStore,
  onProgress: (progress: GbdImportProgress) => void = () => undefined,
): Promise<GbdChunksOutcome> => {
  const { sha256 } = file;
  if (await store.known(sha256)) return { kind: "already-imported", sha256 };
  const reader = createGbdCsvReader();
  const decoder = new TextDecoder("utf-8");
  // Mutable on purpose: this one file's counters and unwritten rows.
  const run = { begun: false, bytes: 0, rows: 0, newRows: 0 };
  let pending: GbdCsvRow[] = [];

  const write = async (rows: readonly GbdCsvRow[]) => {
    if (!run.begun) {
      await store.begin({
        sha256,
        fileName: file.fileName,
        ...(file.citation == null ? {} : { citation: file.citation }),
      });
      run.begun = true;
    }
    if (rows.length > 0) run.newRows += await store.addRows(sha256, rows);
  };

  const refuse = async (error: GbdCsvError): Promise<GbdChunksOutcome> => {
    if (run.begun) await store.abort(sha256);
    return { kind: "refused", sha256, error };
  };

  const take = async (
    result: ReturnType<typeof reader.push>,
  ): Promise<GbdChunksOutcome | null> => {
    if (!result.ok) return refuse(result.error);
    pending = [...pending, ...result.rows];
    run.rows += result.rows.length;
    if (pending.length >= GBD_STORE_BATCH) {
      const batch = pending;
      pending = [];
      await write(batch);
    }
    return null;
  };

  try {
    for await (const chunk of chunks) {
      run.bytes += chunk.byteLength;
      const refused = await take(reader.push(decoder.decode(chunk, { stream: true })));
      if (refused !== null) return refused;
      onProgress({ bytes: run.bytes, rows: run.rows });
    }
    const tail = await take(reader.push(decoder.decode()));
    if (tail !== null) return tail;
    const last = await take(reader.end());
    if (last !== null) return last;
    await write(pending);
    pending = [];
    await store.finish(sha256, { rowCount: run.rows, newRows: run.newRows });
    onProgress({ bytes: run.bytes, rows: run.rows });
    return { kind: "imported", sha256, rowCount: run.rows, newRows: run.newRows };
  } catch (error: unknown) {
    if (run.begun) await store.abort(sha256);
    throw error;
  }
};
