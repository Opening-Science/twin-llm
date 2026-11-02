/**
 * bun run gbd:import <file.csv> [more.csv ...]
 *
 * Imports CSV files a person downloaded from IHME's GBD Results Tool
 * (https://vizhub.healthdata.org/gbd-results/, "Both" IDs and names; see
 * docs/gbd.md) into the local GBD store, for `gbd_estimate` (#387). Each
 * file's SHA-256 is recorded with its base name and row counts; a file
 * already imported is skipped. Nothing is sent anywhere and no file is
 * copied into the repository. Prints file names, checksums and counts only.
 * A `citation.txt` next to a file (IHME puts one in each download) is read
 * and its citation stored with the file's record (#417), for the footer of
 * a GBD profile.
 *
 * The database is DATABASE_URL, from .env.local as for the app; for the
 * eval database pass --env-file=.env.eval to bun (docs/evaluation/question-set.md).
 * Exit code 1 when any file was refused or failed; the others are imported.
 */
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { database } from "../../infrastructure/database";
import { GBD_CITATION_FILE, parseGbdCitation } from "../../packages/gbd-local/citation";
import {
  type GbdImportStore,
  importGbdChunks,
  sha256Of,
} from "../../packages/gbd-local/import-chunks";
import { gbdCsvErrorText } from "../../packages/gbd-local/results-csv";
import { gbdImportStore } from "../../packages/gbd-local/store";

export { sha256Of } from "../../packages/gbd-local/import-chunks";

export type GbdImportDeps = Readonly<{
  readFile: (path: string) => Promise<Buffer>;
  store: GbdImportStore;
  stdout: { write: (chunk: string) => void };
  stderr: { write: (chunk: string) => void };
}>;

/** Imports every path in turn; returns the exit code. */
export const runGbdImport = async (
  paths: readonly string[],
  deps: GbdImportDeps,
): Promise<number> => {
  if (paths.length === 0) {
    deps.stderr.write("usage: bun run gbd:import <file.csv> [more.csv ...]\n");
    return 1;
  }
  let failed = 0;
  for (const path of paths) {
    const name = basename(path);
    const bytes = await deps.readFile(path).catch(() => null);
    if (bytes === null) {
      deps.stderr.write(`${name}: cannot be read\n`);
      failed += 1;
      continue;
    }
    const sha256 = sha256Of(bytes);
    const citation = await deps
      .readFile(join(dirname(path), GBD_CITATION_FILE))
      .then((text) => parseGbdCitation(text.toString("utf8")))
      .catch(() => null);
    try {
      const outcome = await importGbdChunks(
        { sha256, fileName: name, citation },
        [bytes],
        deps.store,
      );
      if (outcome.kind === "refused") {
        deps.stderr.write(`${name}: ${gbdCsvErrorText(outcome.error)}\n`);
        failed += 1;
        continue;
      }
      deps.stdout.write(
        outcome.kind === "already-imported"
          ? `${name} sha256 ${sha256}: already imported, skipped\n`
          : `${name} sha256 ${sha256}: ${outcome.rowCount} rows, ${outcome.newRows} new\n`,
      );
    } catch (error: unknown) {
      deps.stderr.write(
        `${name}: not imported (${error instanceof Error ? error.name : "error"})\n`,
      );
      failed += 1;
    }
  }
  return failed === 0 ? 0 : 1;
};

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  const code = await runGbdImport(process.argv.slice(2), {
    readFile: (path) => readFile(path),
    store: gbdImportStore(database()),
    stdout: process.stdout,
    stderr: process.stderr,
  });
  await database().$disconnect();
  process.exit(code);
}
