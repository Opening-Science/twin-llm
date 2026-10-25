/**
 * Words on the Data page, in one place so the claim lint and a reviewer can
 * read them together. Plain language: the page is for people who did not
 * build the warehouse.
 */

export const DATA_TITLE = "Data";

export const DATA_LEDE =
  "The synthetic people TwinLLM is tested and trained on: what is in the warehouse, and the training conversations made from it.";

export const INTRO_TITLE = "What am I looking at?";

export const INTRO_PARAGRAPHS = [
  "These are made-up people. Synthea is a simulator: it invents residents and lives out their health records year by year, from check-ups and lab tests to hospital stays, using published statistics so the population looks realistic. No real person is in here.",
  "TwinLLM's chat tools, the evaluation and the training conversations all read these rows. Only numbers with a unit are charted here.",
] as const;

export const TERMS: readonly (readonly [string, string])[] = [
  [
    "Subject",
    "One synthetic person, known only by an opaque subject_ref. No name, no address.",
  ],
  [
    "Observation",
    "One measurement at one time: a blood pressure, a weight, a lab value. Text answers, such as survey items, are counted apart.",
  ],
  [
    "LOINC code",
    "The international code for what was measured, for example 29463-7 for body weight. The chat tools ask for data by these codes.",
  ],
  [
    "Unit",
    "The UCUM unit the value was stored in, such as kg or mg/dL. Values in different units are never mixed or converted.",
  ],
  [
    "Cohort",
    "One generated batch of subjects, named by Synthea version and seed. The same seed gives the same people.",
  ],
];

export const NOT_STORED_NOTE =
  "The warehouse keeps no sex, birth year or date of death for a subject yet, so this page cannot split people by them.";

/** What each allowlisted cohort is for (docs/training-data.md). */
export const COHORT_ROLES: Readonly<Record<string, string>> = {
  "open-twin-synthea-trimmed-3": "Three trimmed open-twin fixtures, used by tests.",
  "synthea-v4-seed42":
    "Evaluation cohort: the 81-question set reads it. Never train on it.",
  "synthea-v4-seed4242": "Training cohort.",
  "synthea-v4-seed9001": "Held-out cohort, for testing a trained model.",
};

export const EVAL_COHORT_ID = "synthea-v4-seed42";

export const BLOCKED_COPY = {
  personal:
    "The Data page shows synthetic data only. This server runs in personal mode, so it reads nothing here. Start it with DATA_MODE=synthetic to explore the synthetic cohorts.",
  "sign-in": "Sign in to explore the synthetic cohorts.",
  "not-found": "That cohort or subject is not in the synthetic scope of this server.",
  failed: "Could not read the warehouse just now. Reload the page to try again.",
  "too-large":
    "This subject has more numeric observations than one page reads, so nothing is shown rather than a cut record.",
  "no-cohorts":
    "No allowlisted synthetic cohort has subjects in this database yet. Ingest one with bun run warehouse:ingest (docs/warehouse.md).",
} as const;

export const TRAINING_FAILED =
  "Could not read the training files just now. Reload to try again.";
