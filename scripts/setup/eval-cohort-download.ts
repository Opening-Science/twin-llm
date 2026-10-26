/**
 * The evaluation cohort from its release (`EVAL_RELEASE`): fetching the pinned
 * archive, checking what it unpacked to, and the messages setup shows when it
 * has to generate the cohort instead. Fetching takes its I/O as arguments, so
 * every branch is unit tested; the rest is pure.
 */
import {
  type FetchFn,
  fetchPinned,
  readBounded,
  RedirectRefusedError,
  TooLargeError,
} from "../release/pinned-fetch";
import { EVAL_COHORT, EVAL_RELEASE } from "./cohort-pins";

export type ReleasePin = Readonly<{
  tag: string;
  archive: string;
  url: string;
  archiveBytes: number;
  archiveSha256: string;
  redirectHosts: readonly string[];
}>;

export type ArchiveDeps = Readonly<{
  fetch: FetchFn;
  /** The file's bytes, or null when it does not exist. */
  readFile: (path: string) => Promise<Uint8Array | null>;
  writeFileAtomic: (path: string, bytes: Uint8Array) => Promise<void>;
  sha256: (bytes: Uint8Array) => string;
}>;

export type ArchiveResult =
  | Readonly<{ kind: "cached" }>
  | Readonly<{ kind: "downloaded"; bytes: number }>
  /** The release or its asset does not exist (yet): HTTP 404. */
  | Readonly<{ kind: "not-published"; message: string }>
  | Readonly<{ kind: "failed"; message: string }>;

/**
 * Makes sure `path` holds the pinned archive: kept from an earlier run when
 * its SHA-256 matches, otherwise downloaded, checked against the pinned size
 * and SHA-256, and only then written. A mismatch writes nothing.
 */
export const fetchEvalArchive = async (
  path: string,
  pin: ReleasePin,
  deps: ArchiveDeps,
): Promise<ArchiveResult> => {
  const existing = await deps.readFile(path);
  if (existing !== null && deps.sha256(existing) === pin.archiveSha256)
    return { kind: "cached" };
  let response: Response;
  try {
    response = await fetchPinned(deps.fetch, pin.url, pin.redirectHosts);
  } catch (error) {
    return {
      kind: "failed",
      message:
        error instanceof RedirectRefusedError
          ? `the download of ${pin.archive} was redirected somewhere unexpected; nothing written`
          : `could not download ${pin.archive} (no connection to github.com?)`,
    };
  }
  if (response.status === 404) {
    await response.body?.cancel().catch(() => undefined);
    return {
      kind: "not-published",
      message: `release ${pin.tag} with ${pin.archive} is not published yet`,
    };
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return {
      kind: "failed",
      message: `could not download ${pin.archive} (HTTP ${response.status})`,
    };
  }
  let bytes: Uint8Array;
  try {
    bytes = await readBounded(response, pin.archiveBytes);
  } catch (error) {
    return {
      kind: "failed",
      message:
        error instanceof TooLargeError
          ? `${pin.archive} is larger than its pin; nothing written`
          : `could not download ${pin.archive} (the connection broke off)`,
    };
  }
  if (bytes.byteLength !== pin.archiveBytes || deps.sha256(bytes) !== pin.archiveSha256) {
    return {
      kind: "failed",
      message: `${pin.archive} does not match its pinned SHA-256; nothing written`,
    };
  }
  try {
    await deps.writeFileAtomic(path, bytes);
  } catch {
    return { kind: "failed", message: `could not write ${pin.archive} to ${path}` };
  }
  return { kind: "downloaded", bytes: bytes.byteLength };
};

export type CohortOnDisk = Readonly<{
  files: number;
  contentSha256: string;
  /** `cohortId` from the archive's manifest.json, or null when it names none. */
  manifestCohortId: string | null;
}>;

/** Why the unpacked archive is not the pinned cohort, or null when it is. Pure. */
export const unpackedProblem = (found: CohortOnDisk): string | null => {
  if (found.files !== EVAL_COHORT.patientFileCount)
    return `the archive holds ${found.files} patient files, the pin has ${EVAL_COHORT.patientFileCount}`;
  if (found.contentSha256 !== EVAL_COHORT.contentSha256)
    return `the archive's patient files have contentSha256 ${found.contentSha256}, the pin is ${EVAL_COHORT.contentSha256}`;
  if (found.manifestCohortId !== EVAL_COHORT.cohortId)
    return `the archive's manifest names cohort ${found.manifestCohortId ?? "none"}, not ${EVAL_COHORT.cohortId}`;
  return null;
};

/** Node's `process.arch` as the name people know it by. Pure. */
export const archName = (arch: string): string => (arch === "x64" ? "x86_64" : arch);

/**
 * Why setup generated the cohort instead of downloading it: asked for with
 * `--generate-cohort`, or the download did not work (its message).
 */
export type GenerateReason =
  | Readonly<{ kind: "asked" }>
  | Readonly<{ kind: "download-unavailable"; message: string }>;

/** The line printed before generating because the download did not work. Pure. */
export const fallbackNotice = (message: string): string =>
  `${message}; generating ${EVAL_COHORT.cohortId} locally with Synthea instead.`;

/**
 * The checklist line when a locally generated cohort is not the pin. On
 * another CPU architecture with the same file count this is the known
 * floating-point difference, not a broken setup, and the fix is the download.
 * On the pin's own architecture it is unexpected, so it asks for a report.
 * `rerun` is the command to run again (with or without --reload-cohort). Pure.
 */
export const generatedMismatchMessage = (
  found: Readonly<{ files: number; contentSha256: string }>,
  arch: string,
  reason: GenerateReason,
  rerun: string,
): string => {
  const what = `the cohort generated here does not match the pin (${found.files} files, contentSha256 ${found.contentSha256}; expected ${EVAL_COHORT.patientFileCount} files, ${EVAL_COHORT.contentSha256}). Nothing ingested.`;
  if (arch === "x64" || found.files !== EVAL_COHORT.patientFileCount)
    return `${what} Please report this with .synthea/manifest.json`;
  const platform = `This is a platform difference (${archName(arch)} vs x86_64 floating point): Synthea's java.lang.Math gives a few last digits differently on this CPU than on ${EVAL_RELEASE.generatedOn}, where the pin was made. Nothing is wrong with this machine.`;
  const fix =
    reason.kind === "asked"
      ? `Use the download: ${rerun} (without --generate-cohort) fetches the pinned files from release ${EVAL_RELEASE.tag}.`
      : `Use the download: ${reason.message}; run ${rerun} again once release ${EVAL_RELEASE.tag} can be downloaded.`;
  return `${what} ${platform} ${fix}`;
};
