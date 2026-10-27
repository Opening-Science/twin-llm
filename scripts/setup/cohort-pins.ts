import { RIGGED_RELEASE_HOSTS } from "../../packages/anatomy/rigged-bodies";
import { COHORT_PRESETS, EVAL_CONTENT_SHA256 } from "../synthea/cohort-presets";

/**
 * The cohorts `setup:local` can load, with the checksums it verifies before
 * anything reaches the warehouse.
 */

/**
 * `bun run synthea:generate -- --preset eval`: fixed seeds and dates, so every
 * machine of the same CPU architecture gets the same files. The checksum is the one the answer key records
 * (`EVAL_CONTENT_SHA256`); 37 files for N=30 because Synthea also exports the
 * people who died during the simulation.
 */
export const EVAL_COHORT = {
  cohortId: COHORT_PRESETS.eval.cohortId,
  fhirDir: ".synthea/fhir",
  patientFileCount: 37,
  contentSha256: EVAL_CONTENT_SHA256,
  /** One subject per patient file once ingested. */
  subjectCount: 37,
  /**
   * The ingested bundles' fingerprint (cohort-fingerprint.ts), so a warehouse
   * holding an older cohort under the same id is caught even at 37 subjects.
   * `bun scripts/setup/cohort-fingerprint.ts .synthea/fhir` on the pinned files.
   */
  bundleSetSha256: "469ecc95530aa6f546ef8d04f6a7a6a271d1cc379a25e8f39a30fd0272a18ba6",
  /**
   * Condition and MedicationRequest rows once ingested. The same bundles
   * ingested before these tables existed have the pinned fingerprint but none
   * of these rows, so setup checks the counts too.
   */
  conditionCount: 1995,
  medicationRequestCount: 3615,
} as const;

/**
 * The evaluation cohort's pinned files as a release asset: the 37 bundles in
 * `fhir/` and the generator's `manifest.json`, made on Linux x86_64 by
 * `synthea:generate -- --preset eval`. Synthea's floating-point maths
 * (`java.lang.Math`) can give other last digits on another CPU architecture, so
 * a Mac with Apple Silicon generates a cohort with the same people but another
 * checksum. `setup:local` downloads this archive by default and generates
 * locally only with `--generate-cohort`, or when the release cannot be reached.
 */
export const EVAL_RELEASE = {
  tag: "eval-cohort-v1",
  archive: "eval-cohort-synthea-v4-seed42-20260101.tar.zst",
  url: "https://github.com/Opening-Science/twin-llm/releases/download/eval-cohort-v1/eval-cohort-synthea-v4-seed42-20260101.tar.zst",
  archiveBytes: 4_911_581,
  archiveSha256: "45d84cad9882f9fe7365f42b7bc64b6cedcc6665a412c88a8e56e612712c2b14",
  /** GitHub serves release assets through a redirect; the same hosts anatomy:fetch allows. */
  redirectHosts: RIGGED_RELEASE_HOSTS,
  /** Where the pin was generated; another architecture may not reproduce it. */
  generatedOn: "Linux x86_64",
  /** The archive is kept here for re-runs (about 5 MB). */
  downloadDir: ".synthea/downloads",
  /** Unpacked and checked here before it replaces `.synthea/fhir`. */
  unpackDir: ".synthea/downloads/eval-cohort",
} as const;

/**
 * The 10,000-person reference copy published as a GitHub release
 * (`cohort-synthea-v4-seed42-10k`). It is a different population from the
 * evaluation cohort, so it has its own cohort id.
 */
export const RELEASE_10K = {
  cohortId: "synthea-v4-seed42-10k",
  tag: "cohort-synthea-v4-seed42-10k",
  archive: "synthea-v4-seed42-10k-fhir.tar.zst",
  baseUrl:
    "https://github.com/Opening-Science/twin-llm/releases/download/cohort-synthea-v4-seed42-10k",
  archiveBytes: 925_850_184,
  archiveSha256: "dc906bc6abd809b4590952920beb3198ae5bb46eef5cf824bc72c9325934e024",
  /** `cd out/fhir && sha256sum *.json | sort | sha256sum`, from the release notes. */
  contentSha256: "f918035848aed656e4d573197cc616f4948d2106a0bb368dd629a54dadbc06c2",
  patientFileCount: 11_551,
  /** About 41 GB unpacked, plus the archive and some room. */
  diskBytesNeeded: 45_000_000_000,
  /** Where the archive unpacks under `.synthea/`; the patient files are in `out/fhir`. */
  unpackDir: ".synthea/synthea-v4-seed42-10k",
  downloadDir: ".synthea/downloads",
} as const;

/** The three trimmed open-twin fixtures, the fallback when Java is missing. */
export const FIXTURE_COHORT = {
  cohortId: "open-twin-synthea-trimmed-3",
  fhirDir: "tests/fixtures/synthea",
} as const;
