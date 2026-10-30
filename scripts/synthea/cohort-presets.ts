import {
  SYNTHEA_1M_COHORTS,
  type SyntheticCohortId,
} from "../../packages/query-tools/scope";

/**
 * The named Synthea cohorts, as `scripts/synthea/generate-local.sh --preset`
 * builds them. The test runs the script's `--dry-run` and checks it agrees with
 * this table, so the two cannot drift.
 *
 * Train on `training`, test on `held-out` and on the evaluation question set
 * (`eval`). A seed is never reused across roles. Every preset passes fixed
 * reference and end dates (YYYYMMDD) to Synthea; without them Synthea simulates
 * up to the moment it starts, so the same seed gives other patients on another
 * day. `--preset eval` refuses other dates.
 */
export const COHORT_PRESETS = {
  eval: {
    cohortId: "synthea-v4-seed42",
    role: "evaluation",
    population: 30,
    seed: 42,
    clinicianSeed: 43,
    age: "40-75",
    referenceDate: "20260101",
    endDate: "20260101",
    out: ".synthea",
  },
  training: {
    cohortId: "synthea-v4-seed4242",
    role: "training",
    population: 10_000,
    seed: 4242,
    clinicianSeed: 4243,
    age: "40-75",
    referenceDate: "20260101",
    endDate: "20260101",
    out: ".synthea/synthea-v4-seed4242",
  },
  "held-out": {
    cohortId: "synthea-v4-seed9001",
    role: "held-out",
    population: 1000,
    seed: 9001,
    clinicianSeed: 9002,
    age: "40-75",
    referenceDate: "20260101",
    endDate: "20260101",
    out: ".synthea/synthea-v4-seed9001",
  },
} as const;

export type CohortPresetName = keyof typeof COHORT_PRESETS;

/**
 * `contentSha256` of `--preset eval` (37 patient files), the cohort the
 * evaluation answer key is built from. Two runs, the second under
 * TZ=America/New_York, gave this value. A different value means a different
 * cohort: rebuild the key (docs/evaluation/question-set.md) before changing it.
 */
export const EVAL_CONTENT_SHA256 =
  "f4941fab7a56e17f9dd66b6b6e0fbed379dab8c564c6024831c5fd4aa0ba09eb";

/**
 * How `generate-local.sh` runs Synthea for every cohort, so that the same seeds
 * and dates give the same files: the JVM in UTC (Synthea reads `-r`/`-e` in the
 * JVM's time zone) and one generator thread (more threads race in v4.0.0).
 */
export const SYNTHEA_RUN = {
  timezone: "UTC",
  threadPoolSize: 1,
} as const;

/**
 * The 1M cohort: 100 batches of 10,000, made by the batch script outside this
 * repository (not by `generate-local.sh`) and stored as one
 * `batch-NNN.tar.zst` each, NNN = seed - 1000. Every batch is its own cohort,
 * so `seed` names it. All ages, Massachusetts, Synthea v4.0.0.
 *
 * Seeds 1001 to 1099 are training; 1100 is held out. No batch seed is used by
 * a preset above.
 */
export const SYNTHEA_1M_BATCHES = {
  firstSeed: 1001,
  lastSeed: 1100,
  heldOutSeeds: [1100],
  clinicianSeedOffset: 1000,
  population: 10_000,
  age: "any",
} as const;

export type BatchCohort = Readonly<{
  cohortId: SyntheticCohortId;
  role: "training" | "held-out";
  seed: number;
  clinicianSeed: number;
  population: number;
  age: string;
  archive: string;
}>;

/** The batch with this seed, or null when the seed is not a 1M batch. */
export const batchCohort = (seed: number): BatchCohort | null => {
  const cohortId = SYNTHEA_1M_COHORTS.find((id) => id === `synthea-v4-seed${seed}`);
  if (cohortId === undefined) return null;
  const { heldOutSeeds, clinicianSeedOffset, population, age } = SYNTHEA_1M_BATCHES;
  return {
    cohortId,
    role: (heldOutSeeds as readonly number[]).includes(seed) ? "held-out" : "training",
    seed,
    clinicianSeed: seed + clinicianSeedOffset,
    population,
    age,
    archive: `batch-${String(seed - 1000).padStart(3, "0")}.tar.zst`,
  };
};

/** Every 1M batch, in seed order. */
export const SYNTHEA_1M_BATCH_COHORTS: readonly BatchCohort[] = Array.from(
  { length: SYNTHEA_1M_BATCHES.lastSeed - SYNTHEA_1M_BATCHES.firstSeed + 1 },
  (_, index) => batchCohort(SYNTHEA_1M_BATCHES.firstSeed + index),
).filter((batch) => batch !== null);

/**
 * The supplementary S7 cohort (#277): three keep-module runs of the pinned
 * Synthea, made by `scripts/synthea/s7-cohort.ts`, read by the S7b items.
 */
export const S7_COHORT_ID = "synthea-v4-s7";

/** Cohorts the evaluation reads; training data must never come from them. */
export const EVALUATION_COHORT_IDS: readonly string[] = [
  COHORT_PRESETS.eval.cohortId,
  S7_COHORT_ID,
];
