/**
 * The checksum of a generated cohort's patient files, the `contentSha256` that
 * `generate-local.sh` writes to `manifest.json`. Same value as the shell
 * pipeline open-twin#218 documents:
 *
 *   cd fhir && sha256sum *.json | LC_ALL=C sort | sha256sum
 *
 * that is, the sha256 of the `<sha256>  <file name>` lines, one per `*.json`
 * file, sorted bytewise. Synthea file names never need sha256sum's escaping
 * (no backslash or newline), so it is not reproduced here.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export type CohortFile = Readonly<{ name: string; bytes: Uint8Array }>;

const sha256Hex = (data: Uint8Array | string): string =>
  createHash("sha256").update(data).digest("hex");

/** The checksum of these files, as the shell pipeline computes it. Pure. */
export const contentSha256 = (files: readonly CohortFile[]): string => {
  const lines = files
    .filter((file) => file.name.endsWith(".json"))
    .map((file) => Buffer.from(`${sha256Hex(file.bytes)}  ${file.name}\n`, "utf8"))
    .sort(Buffer.compare);
  return sha256Hex(Buffer.concat(lines));
};

/** The checksum of the `*.json` files directly in `dir` (not in subfolders). */
export const cohortContentSha256 = async (dir: string): Promise<string> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry) => ({
        name: entry.name,
        bytes: await readFile(join(dir, entry.name)),
      })),
  );
  return contentSha256(files);
};

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  const dir = process.argv[2] ?? ".synthea/fhir";
  console.log(await cohortContentSha256(dir));
}
