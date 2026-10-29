/**
 * Files this app runs on that are not in the repository, with the pins they
 * must match, and where the software bill of materials is written. The
 * Synthea generator, `setup:local` and the Lab page read these, so the pin is
 * written down once. No I/O here: paths are relative to the working
 * directory and the caller resolves them.
 */

/** Synthea v4.0.0, the same JAR `scripts/synthea/generate-local.sh` pins. */
export const SYNTHEA_VERSION = "v4.0.0";
export const SYNTHEA_JAR_SHA256 =
  "ed43c20ad40ba5c3bc724503a5af032715fe3c491620b766148e7c2361e6ecc1";
/** Where the JAR goes when `SYNTHEA_JAR` is not set. */
export const SYNTHEA_JAR_DEFAULT_PATH = ".synthea/cache/synthea-with-dependencies.jar";

/**
 * The evaluation cohort's release archive: the 37 bundles and the generator's
 * manifest, made on Linux x86_64 (`scripts/setup/cohort-pins.ts` explains why
 * the architecture matters). `setup:local` keeps the download in
 * `downloadDir` for re-runs.
 */
export const EVAL_COHORT_ARCHIVE = {
  tag: "eval-cohort-v1",
  archive: "eval-cohort-synthea-v4-seed42-20260101.tar.zst",
  url: "https://github.com/Opening-Science/twin-llm/releases/download/eval-cohort-v1/eval-cohort-synthea-v4-seed42-20260101.tar.zst",
  archiveBytes: 4_911_581,
  archiveSha256: "45d84cad9882f9fe7365f42b7bc64b6cedcc6665a412c88a8e56e612712c2b14",
  downloadDir: ".synthea/downloads",
} as const;

/** `bun run sbom` writes the CycloneDX file here (gitignored). */
export const SBOM_PATH = ".sbom/twin-llm.cdx.json";
