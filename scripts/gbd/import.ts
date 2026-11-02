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
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { database } from "../../infrastructure/database";
import { GBD_CITATION_FILE, parseGbdCitation } from "../../packages/gbd-local/citation";
import { parseGbdResultsCsv } from "../../packages/gbd-local/results-csv";
import { type GbdImportOutcome, importGbdFile } from "../../packages/gbd-local/store";

export type GbdImportDeps = Readonly<{
  readFile: (path: string) => Promise<Buffer>;
  store: (file: Parameters<typeof importGbdFile>[1]) => Promise<GbdImportOutcome>;
  stdout: { write: (chunk: string) => void };
  stderr: { write: (chunk: string) => void };
}>;

export const sha256Of = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");

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
    const parsed = parseGbdResultsCsv(bytes.toString("utf8"));
    if (!parsed.ok) {
      const { error } = parsed;
      const where = error.line === undefined ? "" : ` (line ${error.line})`;
      const missing =
        error.missing === undefined ? "" : ` Missing: ${error.missing.join(", ")}.`;
      deps.stderr.write(`${name}: ${error.code}${where}: ${error.message}${missing}\n`);
      failed += 1;
      continue;
    }
    const citation = await deps
      .readFile(join(dirname(path), GBD_CITATION_FILE))
      .then((text) => parseGbdCitation(text.toString("utf8")))
      .catch(() => null);
    try {
      const outcome = await deps.store({
        sha256,
        fileName: name,
        rows: parsed.rows,
        ...(citation === null ? {} : { citation }),
      });
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
    store: (file) => importGbdFile(database(), file),
    stdout: process.stdout,
    stderr: process.stderr,
  });
  await database().$disconnect();
  process.exit(code);
}
