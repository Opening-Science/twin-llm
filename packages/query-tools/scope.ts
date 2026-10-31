const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

/**
 * The 1M cohort's batches: seeds 1001 to 1100, one cohort per batch
 * (`SYNTHEA_1M_BATCHES` in scripts/synthea/cohort-presets.ts has their roles).
 * Built from digits rather than a number range so the type is exactly these
 * hundred ids, not every `synthea-v4-seed${number}`.
 */
export const SYNTHEA_1M_COHORTS = [
  ...DIGITS.flatMap((tens) =>
    DIGITS.map((ones) => `synthea-v4-seed10${tens}${ones}` as const),
  ).filter(
    (id): id is Exclude<typeof id, "synthea-v4-seed1000"> => id !== "synthea-v4-seed1000",
  ),
  "synthea-v4-seed1100",
] as const;

/**
 * Synthetic cohorts the query tools may read. A subject is in scope only when
 * the session is synthetic, the row is `is_synthetic`, and its cohort is listed
 * here. `bun run warehouse:ingest` refuses any other cohort label.
 */
export const SYNTHETIC_COHORTS = [
  "open-twin-synthea-trimmed-3",
  "synthea-v4-seed42",
  // Training and held-out cohorts (scripts/synthea/cohort-presets.ts). They
  // belong in their own database on the GPU machine, not the dev database.
  "synthea-v4-seed4242",
  "synthea-v4-seed9001",
  // The 10,000-person reference copy from the cohort-synthea-v4-seed42-10k
  // release (`bun run setup:local -- --cohort-10k`). Same seed as the
  // evaluation cohort but a different population, so a different id.
  "synthea-v4-seed42-10k",
  // The supplementary S7 cohort (#277, scripts/synthea/s7-cohort.ts): 17 people
  // aged 65 to 90, 13 with atrial fibrillation. Evaluation only.
  "synthea-v4-s7",
  // Every person with atrial fibrillation in the 1M cohort's 100 batches
  // (#293, scripts/heart-brain/af-subset.ts), for the cohort_event_rates
  // items. Evaluation only.
  "synthea-v4-1m-af",
  ...SYNTHEA_1M_COHORTS,
] as const;

export type SyntheticCohortId = (typeof SYNTHETIC_COHORTS)[number];

/**
 * Cohorts the Body twin's Demo may borrow lab values from. The training and
 * held-out cohorts, the 1M batches included, are for training data only, so
 * the Demo never lists them.
 */
export const DEMO_COHORTS = [
  "open-twin-synthea-trimmed-3",
  "synthea-v4-seed42",
] as const satisfies readonly SyntheticCohortId[];

export const isDemoCohort = (cohortId: string): boolean =>
  (DEMO_COHORTS as readonly string[]).includes(cohortId);

export const isAllowedCohort = (cohortId: string): cohortId is SyntheticCohortId =>
  (SYNTHETIC_COHORTS as readonly string[]).includes(cohortId);

export const SUBJECT_SCOPE_VIOLATION = {
  code: "SUBJECT_SCOPE_VIOLATION",
  error: "subject_ref is not in this session scope",
} as const;

export type SubjectScopeViolation = typeof SUBJECT_SCOPE_VIOLATION;

export type CohortOutOfScope = Readonly<{
  code: "SUBJECT_SCOPE_VIOLATION";
  error: string;
  /** The cohorts this session can read that hold subjects here. */
  cohorts: readonly string[];
}>;

/**
 * A cohort_id this session cannot read. Same code as a subject outside the
 * scope, but it says the cohort is the problem and names the ones that are
 * readable: a model that guessed "synthetic-cohort-001" was told the
 * *subject* was out of scope and passed that on as the answer.
 */
export const cohortOutOfScope = (
  scope: SessionScope,
  readable: readonly string[],
): CohortOutOfScope =>
  scope.mode === "synthetic"
    ? {
        code: "SUBJECT_SCOPE_VIOLATION",
        error:
          "cohort_id is not a cohort this session can read; use one listed in cohorts",
        cohorts: [...readable],
      }
    : {
        code: "SUBJECT_SCOPE_VIOLATION",
        error: "no cohort can be read in personal mode",
        cohorts: [],
      };

export type SessionScope = {
  readonly actor: string;
  readonly sessionId: string;
  readonly mode: "synthetic" | "personal";
};

export const cohortInScope = (scope: SessionScope, cohortId: string): boolean =>
  scope.mode === "synthetic" && isAllowedCohort(cohortId);

export const subjectRowInScope = (
  scope: SessionScope,
  subject: { readonly isSynthetic: boolean; readonly cohortId: string } | null,
): boolean =>
  subject !== null && subject.isSynthetic && cohortInScope(scope, subject.cohortId);
