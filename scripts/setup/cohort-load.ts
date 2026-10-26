/**
 * Loading a synthetic cohort for `setup:local`: generate or download it,
 * verify its checksums, then ingest it with `warehouse:ingest`. Each function
 * returns a one-line result for the checklist or throws a plain message.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";

import { cohortContentSha256 } from "../synthea/cohort-checksum";
import { EVAL_COHORT, FIXTURE_COHORT, RELEASE_10K } from "./cohort-pins";
import { deleteCohortRows, formatDeleted, ReloadRefusedError } from "./cohort-reload";
import { fileSha256, openSql } from "./detect";
import { parseIngestSummary, sha256For } from "./ingest-summary";

export class SetupError extends Error {}

/** A step that could not run for a reason the person can fix (shown as skipped, not failed). */
export class SetupBlocked extends Error {}

/** Runs a command with the terminal attached; true when it exits 0. */
export const runCommand = (root: string, argv: readonly string[]): boolean => {
  const [command, ...args] = argv;
  if (!command) return false;
  process.stdout.write(`\n$ ${argv.join(" ")}\n`);
  const run = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  return run.status === 0;
};

/** Runs a command, echoing and keeping its stdout. */
const runCapturing = (
  root: string,
  argv: readonly string[],
): Promise<Readonly<{ code: number; stdout: string }>> =>
  new Promise((resolve) => {
    const [command, ...args] = argv;
    process.stdout.write(`\n$ ${argv.join(" ")}\n`);
    const child = spawn(command ?? "false", args, {
      cwd: root,
      stdio: ["ignore", "pipe", "inherit"],
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      process.stdout.write(chunk);
    });
    child.on("close", (code) =>
      resolve({ code: code ?? 1, stdout: Buffer.concat(chunks).toString("utf8") }),
    );
    child.on("error", () => resolve({ code: 1, stdout: "" }));
  });

const ingest = async (
  root: string,
  dir: string,
  cohortId: string,
  allowRejected: boolean,
): Promise<string> => {
  const { code, stdout } = await runCapturing(root, [
    "bun",
    "run",
    "warehouse:ingest",
    dir,
    "--cohort",
    cohortId,
  ]);
  const summary = parseIngestSummary(stdout);
  if (summary === null)
    throw new SetupError(`warehouse:ingest stopped (exit ${code}); see its output above`);
  if (summary.rejected > 0 && !allowRejected) {
    throw new SetupError(
      `${summary.rejected} bundle(s) rejected by warehouse:ingest; see its output above`,
    );
  }
  const rejected = summary.rejected > 0 ? `, ${summary.rejected} rejected` : "";
  return `${cohortId}: ${summary.inserted} bundles ingested, ${summary.skipped} already there${rejected}`;
};

const readManifest = async (
  path: string,
): Promise<Readonly<Record<string, unknown>> | null> => {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    return typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

const countJson = async (dir: string): Promise<number> =>
  (await readdir(dir).catch(() => [])).filter((name) => name.endsWith(".json")).length;

/** Generates the evaluation cohort (unless an identical copy is on disk) and verifies it. */
const prepareEvalCohort = async (root: string): Promise<void> => {
  const fhir = join(root, EVAL_COHORT.fhirDir);
  const manifest = await readManifest(join(root, ".synthea", "manifest.json"));
  const reuse =
    manifest?.cohortId === EVAL_COHORT.cohortId &&
    manifest.contentSha256 === EVAL_COHORT.contentSha256 &&
    (await countJson(fhir)) === EVAL_COHORT.patientFileCount;
  if (reuse) {
    process.stdout.write(
      `\n${EVAL_COHORT.cohortId} already generated in ${EVAL_COHORT.fhirDir}; checking it.\n`,
    );
  } else if (
    !runCommand(root, ["bun", "run", "synthea:generate", "--", "--preset", "eval"])
  ) {
    throw new SetupError("synthea:generate failed; see its output above");
  }
  const files = await countJson(fhir);
  const content = await cohortContentSha256(fhir);
  if (files !== EVAL_COHORT.patientFileCount || content !== EVAL_COHORT.contentSha256) {
    throw new SetupError(
      `generated cohort does not match the pin (${files} files, contentSha256 ${content}; expected ${EVAL_COHORT.patientFileCount} files, ${EVAL_COHORT.contentSha256}). Nothing ingested. Please report this with .synthea/manifest.json`,
    );
  }
  process.stdout.write(`contentSha256 ${content} matches the pin.\n`);
};

/** The evaluation cohort: generate it (unless an identical copy is on disk), verify, ingest. */
export const loadEvalCohort = async (root: string): Promise<string> => {
  await prepareEvalCohort(root);
  return ingest(root, EVAL_COHORT.fhirDir, EVAL_COHORT.cohortId, false);
};

/**
 * `--reload-cohort`: generate and verify the pinned evaluation cohort first, so
 * a failure there deletes nothing; then delete the warehouse's rows for that
 * cohort in one transaction (cohort-reload.ts) and ingest the pinned files.
 * If the ingest stops part way, running setup again finishes it (ingest skips
 * bundles already there).
 */
export const reloadEvalCohort = async (
  root: string,
  databaseUrl: string,
): Promise<string> => {
  await prepareEvalCohort(root);
  const sql = openSql(databaseUrl);
  let deleted: string;
  try {
    process.stdout.write(
      `\nDeleting ${EVAL_COHORT.cohortId}'s warehouse rows (one transaction) …\n`,
    );
    deleted = formatDeleted(
      EVAL_COHORT.cohortId,
      await deleteCohortRows(sql, EVAL_COHORT.cohortId),
    );
  } catch (error) {
    if (error instanceof ReloadRefusedError) throw new SetupError(error.message);
    throw error;
  } finally {
    await sql.close();
  }
  process.stdout.write(`${deleted}.\n`);
  return `${deleted}; ${await ingest(root, EVAL_COHORT.fhirDir, EVAL_COHORT.cohortId, false)}`;
};

/** The three trimmed fixtures in the repository. */
export const loadFixtures = (root: string): Promise<string> =>
  ingest(root, FIXTURE_COHORT.fhirDir, FIXTURE_COHORT.cohortId, false);

const download = async (
  url: string,
  path: string,
  expectedBytes: number,
): Promise<string> => {
  const response = await fetch(url);
  if (!response.ok || !response.body)
    throw new SetupError(`download failed (HTTP ${response.status}) from ${url}`);
  const partial = `${path}.partial`;
  const hash = createHash("sha256");
  const out = createWriteStream(partial);
  const reader = response.body.getReader();
  let received = 0;
  let reported = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      received += value.byteLength;
      if (!out.write(value))
        await new Promise<void>((resolve) => out.once("drain", () => resolve()));
      if (received - reported >= 50_000_000) {
        reported = received;
        process.stdout.write(
          `  ${Math.round((100 * received) / expectedBytes)}% (${(received / 1e9).toFixed(2)} GB)\n`,
        );
      }
    }
    await new Promise<void>((resolve, reject) =>
      out.end((error?: Error | null) => (error ? reject(error) : resolve())),
    );
  } catch (error) {
    out.destroy();
    await rm(partial, { force: true });
    throw error;
  }
  await rename(partial, path);
  return hash.digest("hex");
};

/**
 * The 10k release: download the archive (kept for re-runs), check it against
 * the pin and the release's SHA256SUMS, unpack it, check the patient files'
 * content checksum, ingest, then delete the unpacked files (about 41 GB).
 */
export const loadRelease10k = async (root: string): Promise<string> => {
  const release = RELEASE_10K;
  const downloads = join(root, release.downloadDir);
  await mkdir(downloads, { recursive: true });
  const sumsResponse = await fetch(`${release.baseUrl}/SHA256SUMS`);
  const listed = sumsResponse.ok
    ? sha256For(await sumsResponse.text(), release.archive)
    : null;
  if (listed !== release.archiveSha256) {
    throw new SetupError(
      `the release's SHA256SUMS lists ${listed ?? "no hash"} for ${release.archive}, the pin is ${release.archiveSha256}. Nothing downloaded.`,
    );
  }
  const archive = join(downloads, release.archive);
  const present = existsSync(archive) ? await fileSha256(archive) : null;
  if (present === release.archiveSha256) {
    process.stdout.write(`\n${release.archive} already downloaded and verified.\n`);
  } else {
    process.stdout.write(
      `\nDownloading ${release.archive} (${(release.archiveBytes / 1e9).toFixed(2)} GB) …\n`,
    );
    const got = await download(
      `${release.baseUrl}/${release.archive}`,
      archive,
      release.archiveBytes,
    );
    if (got !== release.archiveSha256) {
      await rm(archive, { force: true });
      throw new SetupError(
        `archive sha256 ${got} does not match the pin ${release.archiveSha256}; deleted it`,
      );
    }
    process.stdout.write("Archive sha256 matches the pin.\n");
  }

  const unpack = join(root, release.unpackDir);
  await rm(unpack, { recursive: true, force: true });
  await mkdir(unpack, { recursive: true });
  process.stdout.write(`Unpacking into ${release.unpackDir} (about 41 GB) …\n`);
  const untar = spawnSync(
    "sh",
    ["-c", 'zstd -dc "$1" | tar -xf - -C "$2"', "sh", archive, unpack],
    {
      stdio: "inherit",
    },
  );
  if (untar.status !== 0)
    throw new SetupError("unpacking the archive failed; see the output above");

  const fhir = join(unpack, "out", "fhir");
  const files = await countJson(fhir);
  const content = await cohortContentSha256(fhir);
  if (files !== release.patientFileCount || content !== release.contentSha256) {
    throw new SetupError(
      `unpacked cohort does not match the release (${files} files, contentSha256 ${content}). Nothing ingested.`,
    );
  }
  process.stdout.write(`contentSha256 ${content} matches the release.\n`);
  const manifest = await readManifest(join(unpack, "out", "manifest.json"));
  const named = manifest?.cohortId;
  if (typeof named === "string" && named !== release.cohortId) {
    throw new SetupError(
      `the archive's manifest names cohort ${named}, not ${release.cohortId}. Nothing ingested.`,
    );
  }
  // Some 10k bundles carry units the warehouse refuses (as in the 1M batches);
  // the rest still load, and the checklist says how many were rejected.
  const result = await ingest(
    root,
    join(release.unpackDir, "out", "fhir"),
    release.cohortId,
    true,
  );
  await rm(unpack, { recursive: true, force: true });
  return `${result} (unpacked files removed; archive kept in ${release.downloadDir})`;
};
