/**
 * What a tool's result code means, as one plain sentence for the step trace
 * and the Markdown export: "No readings in this range", never `NO_ROWS`.
 * The code itself stays in the card's fold-out and in the audit row, where it
 * helps debugging. Research tone; no tool names, settings or storage words.
 *
 * Every code a tool can return has a sentence here (`tool-code-sentences.test.ts`
 * scans the tool layer for them); a code with none reads the generic sentence.
 * Pure.
 */

const SENTENCES: Readonly<Record<string, string>> = {
  // Scope and size of a read.
  SUBJECT_SCOPE_VIOLATION: "That person is outside what this session may read",
  ROW_CAP_EXCEEDED: "Too many readings in this range to read at once",
  COHORT_ROW_CAP_EXCEEDED: "Too many cohort readings in this range to compare at once",
  COHORT_RECORD_CAP_EXCEEDED: "Too many records in this cohort to count at once",
  SUBJECT_REQUIRED: "A cohort measure needs a person to read it for",
  OUTSIDE_SUBJECT_WINDOW: "That day is outside this person's records",
  RECORDS_NOT_IN_SKILL: "This skill reads no personal records",
  COHORT_TOOLS_OFF: "Cohort records are not available here",

  // What the readings hold.
  NO_ROWS: "No readings in this range",
  MIXED_UNITS: "The readings use more than one unit, so they were not combined",
  UNSUPPORTED_CONVERSION: "There is no known conversion between these units",
  SOURCE_NOT_CONNECTED: "That wearable is not connected, so nothing was read",
  WINDOW_TOO_SHORT: "Too few days in this range for a trend",
  NO_RHYTHM_DATA: "No heart rhythm recording is available here",
  UNKNOWN_MEASURE: "That measure is not one this app knows",
  NO_PUBLISHED_RANGE: "No published reference range for this measure",
  UNIT_MISMATCH: "The reading's unit differs from the published range's",
  COHORT_TOO_SMALL: "Too few people in the synthetic cohort have a value to compare",
  COHORT_NOT_SUPPORTED: "Event rates are not available for this cohort",
  DESIGN_NOT_SUPPORTED: "This cohort does not support that study design",

  // Views.
  VIEW_NOT_ALLOWED: "This view isn't allowed for this question",
  VIEW_NOT_FOUND: "No chart like that in this conversation",
  WINDOW_REQUIRED: "This view needs a date range",
  COMPARE_WINDOW_REQUIRED: "A comparison needs an earlier range to set against",
  MEASURE_REQUIRED: "This view needs a measure",
  LOINC_REQUIRED: "A reference range card needs a lab measure",
  FOCUS_REQUIRED: "The body view needs an organ or body system",
  NOT_AUDITED: "The read could not be recorded, so nothing was drawn",
  ESTIMATES_REQUIRED: "A map needs population estimates looked up first",
  STATES_REQUIRED: "A country map needs estimates for its states first",
  NO_SUBNATIONAL_BOUNDARIES: "No state or province borders for this country",
  NOTHING_TO_MAP: "None of these places can be drawn at this level",

  // Imported files.
  IMPORTED_DATA_NOT_PERMITTED: "Imported files are read only in personal mode",
  DATASET_NOT_FOUND: "No imported file like that",
  SERIES_NOT_COMBINED: "A coded series and a named one were not combined",
  PARTIAL_DATES: "Some dates give only a month or a year, so no trend was fitted",
  WRONG_DATASET_KIND: "That imported file is not the kind this step reads",
  UNKNOWN_COLUMNS: "Those columns are not in the imported table",

  // Population estimates.
  GBD_NOT_IMPORTED: "No population estimates are available here yet",
  GBD_UNKNOWN_LOCATION: "No estimates for a place by that name",
  GBD_AMBIGUOUS_LOCATION: "More than one place has that name",
  GBD_UNKNOWN_CAUSE: "No estimates for a cause by that name",
  GBD_UNKNOWN_RISK: "No estimates for a risk factor by that name",
  GBD_NO_ESTIMATE: "No estimate for that combination",
  GBD_NO_SDI: "No estimates by development level are available",
  GBD_TOO_MANY_ROWS: "Too many estimates match to show at once",

  // Genome.
  GENOME_NOT_PERMITTED:
    "Genome questions are answered only in personal mode on this device",
  NO_REPORT: "No genome report has been released yet",
  RSID_NOT_IN_REPORT: "That variant is not in the released report",
  NO_CALL: "The report has no genotype at that variant",
  INCOMPLETE_ROW: "The report has no position for that variant",
  TOO_MANY_VARIANTS: "Too many variants asked at once",
  MALFORMED_VARIANT_NAMES: "Some variant names could not be read",
  NOT_A_VCF_DATASET: "That imported file holds no variants",
  BUILD_MISMATCH: "The report uses a different genome build from the reference",
  BUILD_UNKNOWN: "The report's genome build is unknown",
  REF_MISMATCH: "The report's reference base differs from the reference genome",
  REF_STRAND_MISMATCH: "The report reads the other DNA strand",
  OUT_OF_RANGE: "That position is outside the chromosome",
  REFERENCE_NOT_CONFIGURED: "No reference genome is available on this device",
  REFERENCE_MISSING: "The reference genome lacks that chromosome",
  REFERENCE_UNREADABLE: "The reference genome could not be read",
  CARBON_X_NOT_LOCAL: "The genome model is not on this device, so nothing was sent",
  CARBON_X_UNREACHABLE: "The genome model is not running",
  CARBON_X_TIMEOUT: "The genome model did not answer in time",
  CARBON_X_FAILED: "The genome model returned no answer",

  // Public databases.
  LIVE_SOURCE_LOCAL_ONLY: "Public database lookups are off here, so nothing was sent",
  LIVE_SOURCE_INCOGNITO: "Public database lookups are off in incognito chats",
  LIVE_SOURCE_OFF: "This public database is switched off, so nothing was sent",
  LIVE_SOURCE_NOT_RECORDED: "The lookup could not be recorded, so it was not sent",
  LIVE_SOURCE_FAILED: "The public database did not answer",
  LIVE_QUERY_REFUSED: "The lookup was not one that may be sent",
  LIVE_NOT_FOUND: "The public database has no gene or variant by that name",
};

/** Where a code's usual sentence would be wrong for one step (it lists records, not readings). */
const STEP_SENTENCES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  list_subjects: {
    SUBJECT_SCOPE_VIOLATION: "That cohort is not one this session may read",
  },
  conditions_timeline: {
    NO_ROWS: "No recorded condition in this range",
    ROW_CAP_EXCEEDED: "Too many records in this range to read at once",
  },
  medications_timeline: {
    NO_ROWS: "No recorded medication request in this range",
    ROW_CAP_EXCEEDED: "Too many records in this range to read at once",
  },
};

/** For a code no sentence covers yet. */
export const GENERIC_CODE_SENTENCE = "This step returned no result";

/** Codes with a sentence; the test checks every code the tools return is among them. */
export const SENTENCE_CODES: readonly string[] = Object.keys(SENTENCES);

/** One plain sentence for a tool's result code. */
export const toolCodeSentence = (tool: string, code: string): string =>
  STEP_SENTENCES[tool]?.[code] ?? SENTENCES[code] ?? GENERIC_CODE_SENTENCE;
