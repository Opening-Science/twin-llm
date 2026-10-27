/**
 * Words on the Data page, in one place so the claim lint and a reviewer can
 * read them together. Plain language: the page is for people who did not
 * build the warehouse.
 */

export const DATA_TITLE = "Synthetic cohort";

/** Shown beside the title on every Data screen, in any DATA_MODE. */
export const SYNTHETIC_DATA_LABEL = "Synthetic data";

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
  "For each synthetic person the warehouse keeps sex, birth year and, for people who died, the year of death: years only, never a full date. Nothing else about them is stored.";

export const SEX_AGE_TITLE = "Sex and age";

/** How the ages in the split are taken; the years are filled in on the page. */
export const sexAgeNote = (referenceYear: number | null, deceased: number): string =>
  [
    referenceYear === null
      ? "Age from the birth year."
      : `Age reached in ${referenceYear}, the year of the cohort's latest reading, from the birth year only, so it can be one year more than on a given day.`,
    deceased > 0
      ? "People who died are counted at the age reached in the year of death."
      : "",
    "Bands are 10 years wide.",
  ]
    .filter((part) => part !== "")
    .join(" ");

export const SEX_AGE_MISSING =
  "Sex and birth year are not stored for this cohort yet: it was ingested before they were kept. Running bun run warehouse:ingest over its files again fills them in without changing any observation; for the evaluation cohort, bun run setup:local -- --reload-cohort does the same.";

/** What each allowlisted cohort is for (docs/training-data.md). */
export const COHORT_ROLES: Readonly<Record<string, string>> = {
  "open-twin-synthea-trimmed-3": "Three trimmed open-twin fixtures, used by tests.",
  "synthea-v4-seed42":
    "Evaluation cohort: the 81-question set reads it. Never train on it.",
  "synthea-v4-seed4242": "Training cohort.",
  "synthea-v4-seed9001": "Held-out cohort, for testing a trained model.",
  "synthea-v4-seed42-10k":
    "Reference cohort of 10,000 people from the cohort-synthea-v4-seed42-10k release.",
};

export const EVAL_COHORT_ID = "synthea-v4-seed42";

export const BLOCKED_COPY = {
  "sign-in": "Sign in to explore the synthetic cohorts.",
  "not-found": "That cohort or subject is not in the synthetic scope of this server.",
  failed: "Could not read the warehouse just now. Reload the page to try again.",
  "too-large":
    "This subject has more numeric observations than one page reads, so nothing is shown rather than a cut record.",
} as const;

export const NO_COHORT_TITLE = "No synthetic cohort loaded on this machine";
export const NO_COHORT_BODY =
  "The warehouse in this database has no subjects in an allowlisted synthetic cohort, so there is nothing to show yet. One command sets up a fresh checkout and generates the 30-person evaluation cohort with Synthea (fixed seed and dates, so every machine gets the same people). It needs Java 21; without it, it loads three small fixtures and says what to install. docs/runbook.md has the details.";
export const NO_COHORT_COMMANDS = [
  "bun run setup:local",
  "",
  "# or the 10,000-person release (about 1 GB download, 45 GB free disk):",
  "bun run setup:local -- --cohort-10k",
] as const;

export const TRAINING_FAILED =
  "Could not read the training files just now. Reload to try again.";
