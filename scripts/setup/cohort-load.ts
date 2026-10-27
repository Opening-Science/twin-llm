/**
 * Loading a synthetic cohort for `setup:local`: generate or download it,
 * verify its checksums, then ingest it with `warehouse:ingest`. Each function
 * returns a one-line result for the checklist or throws a plain message.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { cohortContentSha256 } from "../synthea/cohort-checksum";
import { EVAL_COHORT, EVAL_RELEASE, FIXTURE_COHORT, RELEASE_10K } from "./cohort-pins";
import { deleteCohortRows, formatDeleted, ReloadRefusedError } from "./cohort-reload";
import { fileSha256, openSql } from "./detect";
import {
  fallbackNotice,
  fetchEvalArchive,
  type GenerateReason,
  generatedMismatchMessage,
  unpackedProblem,
} from "./eval-cohort-download";
import { parseIngestSummary, sha256For } from "./ingest-summary";
import { type EvalSource, RELOAD_COMMAND, SETUP_COMMAND } from "./plan";

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

const unpack = (archive: string, dir: string): boolean =>
  spawnSync("sh", ["-c", 'zstd -dc "$1" | tar -xf - -C "$2"', "sh", archive, dir], {
    stdio: "inherit",
  }).status === 0;

/**
 * Downloads the pinned archive (kept for re-runs), unpacks it beside
 * `.synthea/fhir`, checks it, and only then puts its `fhir/` and
 * `manifest.json` in place of the ones in `.synthea/`. Returns null when the
 * cohort is in place, otherwise why not; nothing in `.synthea/fhir` is touched
 * then.
 */
const downloadEvalCohort = async (root: string): Promise<string | null> => {
  const archive = join(root, EVAL_RELEASE.downloadDir, EVAL_RELEASE.archive);
  await mkdir(dirname(archive), { recursive: true });
  process.stdout.write(
    `\nRelease ${EVAL_RELEASE.tag}: ${EVAL_RELEASE.archive} (${(EVAL_RELEASE.archiveBytes / 1e6).toFixed(1)} MB) …\n`,
  );
  const got = await fetchEvalArchive(archive, EVAL_RELEASE, {
    fetch: (url, init) => fetch(url, init),
    readFile: async (path) => {
      try {
        return new Uint8Array(await readFile(path));
      } catch {
        return null;
      }
    },
    writeFileAtomic: async (path, bytes) => {
      const partial = `${path}.partial`;
      try {
        await writeFile(partial, bytes);
        await rename(partial, path);
      } catch (error) {
        await rm(partial, { force: true });
        throw error;
      }
    },
    sha256: (bytes) => createHash("sha256").update(bytes).digest("hex"),
  });
  if (got.kind === "not-published" || got.kind === "failed") return got.message;
  process.stdout.write(
    got.kind === "cached"
      ? `${EVAL_RELEASE.archive} already downloaded; SHA-256 matches the pin.\n`
      : `SHA-256 matches the pin.\n`,
  );

  const dir = join(root, EVAL_RELEASE.unpackDir);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  try {
    if (!unpack(archive, dir)) return `unpacking ${EVAL_RELEASE.archive} failed`;
    const fhir = join(dir, "fhir");
    const manifest = await readManifest(join(dir, "manifest.json"));
    const problem = unpackedProblem({
      files: await countJson(fhir),
      contentSha256: await cohortContentSha256(fhir),
      manifestCohortId: typeof manifest?.cohortId === "string" ? manifest.cohortId : null,
    });
    if (problem !== null) return problem;
    const synthea = join(root, ".synthea");
    await rm(join(synthea, "fhir"), { recursive: true, force: true });
    await rm(join(synthea, "manifest.json"), { force: true });
    await rename(fhir, join(synthea, "fhir"));
    await rename(join(dir, "manifest.json"), join(synthea, "manifest.json"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  process.stdout.write(
    `${EVAL_COHORT.patientFileCount} files from release ${EVAL_RELEASE.tag} in ${EVAL_COHORT.fhirDir}.\n`,
  );
  return null;
};

/** Generates the evaluation cohort with Synthea and checks it against the pin. */
const generateEvalCohort = async (
  root: string,
  reason: GenerateReason,
  rerun: string,
): Promise<void> => {
  if (!runCommand(root, ["bun", "run", "synthea:generate", "--", "--preset", "eval"])) {
    throw new SetupError("synthea:generate failed; see its output above");
  }
  const fhir = join(root, EVAL_COHORT.fhirDir);
  const files = await countJson(fhir);
  const content = await cohortContentSha256(fhir);
  if (files !== EVAL_COHORT.patientFileCount || content !== EVAL_COHORT.contentSha256) {
    throw new SetupError(
      generatedMismatchMessage(
        { files, contentSha256: content },
        process.arch,
        reason,
        rerun,
      ),
    );
  }
  process.stdout.write(`contentSha256 ${content} matches the pin.\n`);
};

/**
 * Puts the pinned evaluation cohort in `.synthea/fhir`: keeps an identical
 * copy already there, else downloads it (the default) or generates it
 * (`--generate-cohort`, or when the release cannot be reached). Returns how.
 */
const prepareEvalCohort = async (
  root: string,
  source: EvalSource,
  rerun: string,
): Promise<string> => {
  const fhir = join(root, EVAL_COHORT.fhirDir);
  const manifest = await readManifest(join(root, ".synthea", "manifest.json"));
  const onDisk =
    manifest?.cohortId === EVAL_COHORT.cohortId &&
    manifest.contentSha256 === EVAL_COHORT.contentSha256 &&
    (await countJson(fhir)) === EVAL_COHORT.patientFileCount &&
    (await cohortContentSha256(fhir)) === EVAL_COHORT.contentSha256;
  if (onDisk) {
    process.stdout.write(
      `\n${EVAL_COHORT.cohortId} already in ${EVAL_COHORT.fhirDir}; contentSha256 matches the pin.\n`,
    );
    return "pinned files already on disk";
  }
  if (source.kind === "generate") {
    await generateEvalCohort(root, { kind: "asked" }, rerun);
    return "generated with Synthea, contentSha256 as pinned";
  }
  const problem = await downloadEvalCohort(root);
  if (problem === null)
    return `downloaded from release ${EVAL_RELEASE.tag}, SHA-256 as pinned`;
  if (source.noGenerate !== null) {
    throw new SetupBlocked(
      `${problem}, and generating it locally needs ${source.noGenerate}. Then run ${rerun} again.`,
    );
  }
  process.stdout.write(`\n${fallbackNotice(problem)}\n`);
  await generateEvalCohort(
    root,
    { kind: "download-unavailable", message: problem },
    rerun,
  );
  return `generated with Synthea (${problem}), contentSha256 as pinned`;
};

/**
 * Deletes one cohort's warehouse rows in one transaction (cohort-reload.ts)
 * and returns the checklist line. Nothing is deleted when it refuses.
 */
const deleteCohort = async (
  databaseUrl: string,
  cohortId: string,
  why: string,
): Promise<string> => {
  const sql = openSql(databaseUrl);
  try {
    process.stdout.write(
      `\nDeleting ${cohortId}'s warehouse rows (one transaction)${why} …\n`,
    );
    const deleted = formatDeleted(cohortId, await deleteCohortRows(sql, cohortId));
    process.stdout.write(`${deleted}.\n`);
    return deleted;
  } catch (error) {
    if (error instanceof ReloadRefusedError) throw new SetupError(error.message);
    throw error;
  } finally {
    await sql.close();
  }
};

/**
 * The trimmed fixtures' people are also in the evaluation cohort (#96), and a
 * subject belongs to one cohort only, so their rows go before the evaluation
 * cohort is ingested. `databaseUrl` is null when the fixtures are not loaded.
 */
const replaceFixtures = async (databaseUrl: string | null): Promise<string> =>
  databaseUrl === null
    ? ""
    : `${await deleteCohort(
        databaseUrl,
        FIXTURE_COHORT.cohortId,
        `, whose subjects are also in ${EVAL_COHORT.cohortId}`,
      )}; `;

/**
 * The evaluation cohort: download (or generate) it, verify, delete the
 * fixture cohort when it is loaded (`fixturesDatabaseUrl`), ingest.
 */
export const loadEvalCohort = async (
  root: string,
  source: EvalSource,
  fixturesDatabaseUrl: string | null = null,
): Promise<string> => {
  const how = await prepareEvalCohort(root, source, SETUP_COMMAND);
  const fixtures = await replaceFixtures(fixturesDatabaseUrl);
  return `${fixtures}${await ingest(root, EVAL_COHORT.fhirDir, EVAL_COHORT.cohortId, false)} (${how})`;
};

/**
 * `--reload-cohort`: download (or generate) and verify the pinned evaluation
 * cohort first, so a failure there deletes nothing; then delete the
 * warehouse's rows for that cohort (and the fixture cohort's, when
 * `replacesFixtures`) in one transaction each (cohort-reload.ts) and ingest
 * the pinned files. If the ingest stops part way, running setup again
 * finishes it (ingest skips bundles already there).
 */
export const reloadEvalCohort = async (
  root: string,
  databaseUrl: string,
  source: EvalSource,
  replacesFixtures = false,
): Promise<string> => {
  const how = await prepareEvalCohort(root, source, RELOAD_COMMAND);
  const fixtures = await replaceFixtures(replacesFixtures ? databaseUrl : null);
  const deleted = await deleteCohort(databaseUrl, EVAL_COHORT.cohortId, "");
  return `${fixtures}${deleted}; ${await ingest(root, EVAL_COHORT.fhirDir, EVAL_COHORT.cohortId, false)} (${how})`;
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
