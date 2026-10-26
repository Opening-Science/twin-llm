/**
 * Which cohort the warehouse actually holds. `warehouse:ingest` records every
 * bundle under the SHA-256 of its JSON (`bundleSha` in
 * packages/warehouse/ingest-bundle.ts), so the sorted list of those hashes
 * identifies an ingested cohort without the original files. Its SHA-256 is
 * pinned next to the file checksum (`EVAL_COHORT.bundleSetSha256`) and
 * `detect.ts` computes the same value in SQL from the `bundles` table.
 *
 *   bun scripts/setup/cohort-fingerprint.ts .synthea/fhir   # prints the value for a folder
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { bundleSha } from "../../packages/warehouse/bundle-sha";

/** SHA-256 of the bundle hashes, sorted, one per line with a trailing newline. Pure. */
export const bundleSetSha256 = (shas: readonly string[]): string =>
  createHash("sha256")
    .update(
      shas
        .toSorted()
        .map((sha) => `${sha}\n`)
        .join(""),
    )
    .digest("hex");

/** The same SQL-side, so detection needs no files: one row, `n` and `digest`. */
export const BUNDLE_SET_SQL =
  "select count(*)::int as n, encode(sha256(convert_to(coalesce(string_agg(sha || E'\\n', '' order by sha collate \"C\"), ''), 'UTF8')), 'hex') as digest from bundles where cohort_id = $1";

/** The fingerprint the `*.json` bundles in `dir` will have once ingested. */
export const folderBundleSetSha256 = async (dir: string): Promise<string> => {
  const names = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
  const shas: string[] = [];
  for (const name of names) {
    shas.push(bundleSha(JSON.parse(await readFile(join(dir, name), "utf8"))));
  }
  return bundleSetSha256(shas);
};

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  console.log(await folderBundleSetSha256(process.argv[2] ?? ".synthea/fhir"));
}
