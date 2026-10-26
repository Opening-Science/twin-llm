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
import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

export type CohortFile = Readonly<{ name: string; bytes: Uint8Array }>;
export type CohortFileDigest = Readonly<{ name: string; sha256: string }>;

const sha256Hex = (data: Uint8Array | string): string =>
  createHash("sha256").update(data).digest("hex");

/** The checksum from each file's own sha256, as the shell pipeline computes it. Pure. */
export const contentSha256FromDigests = (files: readonly CohortFileDigest[]): string => {
  const lines = files
    .filter((file) => file.name.endsWith(".json"))
    .map((file) => Buffer.from(`${file.sha256}  ${file.name}\n`, "utf8"))
    .sort(Buffer.compare);
  return sha256Hex(Buffer.concat(lines));
};

/** The checksum of these files, as the shell pipeline computes it. Pure. */
export const contentSha256 = (files: readonly CohortFile[]): string =>
  contentSha256FromDigests(
    files.map((file) => ({ name: file.name, sha256: sha256Hex(file.bytes) })),
  );

const streamSha256 = (path: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });

/**
 * The checksum of the `*.json` files directly in `dir` (not in subfolders).
 * Files are hashed one at a time, so a 40 GB cohort does not need 40 GB of
 * memory.
 */
export const cohortContentSha256 = async (dir: string): Promise<string> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name);
  const digests: CohortFileDigest[] = [];
  for (const name of names) {
    digests.push({ name, sha256: await streamSha256(join(dir, name)) });
  }
  return contentSha256FromDigests(digests);
};

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  const dir = process.argv[2] ?? ".synthea/fhir";
  console.log(await cohortContentSha256(dir));
}
