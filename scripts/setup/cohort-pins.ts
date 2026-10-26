import { COHORT_PRESETS } from "../synthea/cohort-presets";

/**
 * The cohorts `setup:local` can load, with the checksums it verifies before
 * anything reaches the warehouse.
 */

/**
 * `bun run synthea:generate -- --preset eval`: fixed seeds and dates, so every
 * machine gets the same files. `contentSha256` is the value `manifest.json`
 * records (scripts/synthea/cohort-checksum.ts); 37 files for N=30 because
 * Synthea also exports the people who died during the simulation. Measured
 * 2026-10-26 on Linux (OpenJDK 21.0.12), identical with TZ=America/New_York.
 * The answer key in evaluation/ still describes the 33-file cohort made before
 * the dates were fixed (#29).
 */
export const EVAL_COHORT = {
  cohortId: COHORT_PRESETS.eval.cohortId,
  fhirDir: ".synthea/fhir",
  patientFileCount: 37,
  contentSha256: "f4941fab7a56e17f9dd66b6b6e0fbed379dab8c564c6024831c5fd4aa0ba09eb",
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
