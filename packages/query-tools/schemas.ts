import { z } from "zod";

import { CONVERSION_ANALYTES, CONVERSION_UNITS } from "./unit-conversions";

export const loincSchema = z
  .string()
  .regex(/^\d{1,5}-\d+$/)
  .describe("LOINC code");

export const subjectRefSchema = z.string().min(1).max(128).describe("Opaque subject_ref");

export const cohortIdSchema = z.string().min(1).max(128).describe("Cohort id");

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** A plain date means the whole UTC day: its first instant as a start… */
export const windowStartDate = (value: string): Date =>
  new Date(DATE_ONLY.test(value) ? `${value}T00:00:00.000Z` : value);

/** …and its last instant as an end. */
export const windowEndDate = (value: string): Date =>
  new Date(DATE_ONLY.test(value) ? `${value}T23:59:59.999Z` : value);

// zod 4.6 requires seconds in a UTC datetime (RFC 3339); models often write `…T08:00Z`, so accept that too.
const windowBound = () =>
  z.union([z.iso.datetime(), z.iso.datetime({ precision: -1 }), z.iso.date()]);

const windowStart = windowBound().describe(
  "ISO-8601 UTC datetime, or YYYY-MM-DD for the start of that day",
);

const windowEnd = windowBound().describe(
  "ISO-8601 UTC datetime, or YYYY-MM-DD for the end of that day",
);

export const listSubjectsInput = z
  .object({
    cohort_id: cohortIdSchema,
  })
  .describe("List subject_ref values in a cohort");

export const subjectWindowInput = z
  .object({
    subject_ref: subjectRefSchema,
  })
  .describe("Observation time window and count for one subject");

export const observationsForSubjectInput = z
  .object({
    subject_ref: subjectRefSchema,
    loinc: z.array(loincSchema).min(1).max(20),
    start: windowStart,
    end: windowEnd,
    limit: z.number().int().min(1).max(500),
  })
  .describe("Numeric observations for a subject, codes, and time range");

export const latestByLoincInput = z
  .object({
    subject_ref: subjectRefSchema,
    loinc: z.array(loincSchema).min(1).max(20),
  })
  .describe("Latest numeric row per LOINC for a subject");

export const summaryStatsInput = z
  .object({
    subject_ref: subjectRefSchema,
    loinc: loincSchema,
    start: windowStart,
    end: windowEnd,
  })
  .describe("n / min / max / mean for one LOINC in a window");

const startBeforeEnd = (window: { readonly start: string; readonly end: string }) =>
  windowStartDate(window.start).getTime() < windowEndDate(window.end).getTime();

const START_BEFORE_END = { message: "start must be before end" } as const;

export const windowSchema = z
  .object({
    start: windowStart,
    end: windowEnd,
  })
  .strict()
  .refine(startBeforeEnd, START_BEFORE_END)
  .describe("Time window, ISO-8601 UTC or YYYY-MM-DD, start before end");

export const trendInput = z
  .object({
    subject_ref: subjectRefSchema,
    loinc: loincSchema,
    start: windowStart,
    end: windowEnd,
  })
  .strict()
  .refine(startBeforeEnd, START_BEFORE_END)
  .describe("Least-squares trend for one LOINC in a window");

export const baselineDeviationInput = z
  .object({
    subject_ref: subjectRefSchema,
    loinc: loincSchema,
    baseline: windowSchema,
    target: windowSchema,
  })
  .strict()
  .describe("Target-window median against a baseline window, as a robust z");

export const coverageInput = z
  .object({
    subject_ref: subjectRefSchema,
    loinc: z.array(loincSchema).min(1).max(20),
    start: windowStart,
    end: windowEnd,
  })
  .strict()
  .refine(startBeforeEnd, START_BEFORE_END)
  .describe("How much data there is per LOINC in a window");

export const compareWindowsInput = z
  .object({
    subject_ref: subjectRefSchema,
    loinc: loincSchema,
    window_a: windowSchema,
    window_b: windowSchema,
  })
  .strict()
  .describe("One LOINC in two windows, and B minus A");

export const RANGE_POSITION_PICKS = ["latest", "at"] as const;

const pickAtAgree = (input: { readonly pick: string; readonly at?: string }) =>
  (input.pick === "at") === (input.at !== undefined);

export const rangePositionInput = z
  .object({
    subject_ref: subjectRefSchema,
    loinc: loincSchema,
    start: windowStart,
    end: windowEnd,
    pick: z
      .enum(RANGE_POSITION_PICKS)
      .describe(
        "latest: the newest reading in the window; at: the reading taken at `at`",
      ),
    at: z
      .union([z.iso.datetime(), z.iso.datetime({ precision: -1 })])
      .optional()
      .describe(
        "With pick at only: the reading's effective_at as observations_for_subject returns it",
      ),
  })
  .strict()
  .refine(startBeforeEnd, START_BEFORE_END)
  .refine(pickAtAgree, { message: "at is required with pick at, and only then" })
  .describe("One reading of one LOINC against its Anchor v3 published range");

const conversionUnit = z.enum(CONVERSION_UNITS);

export const convertUnitInput = z
  .object({
    value: z.number().min(-1000).max(100000).describe("The value to convert"),
    from: conversionUnit.describe("UCUM unit of value"),
    to: conversionUnit.describe("UCUM unit to convert to"),
    analyte: z.enum(CONVERSION_ANALYTES).describe("What was measured"),
  })
  .strict()
  .describe("One value of one analyte from one unit to another, by a fixed table");

export const cohortPositionInput = z
  .object({
    subject_ref: subjectRefSchema,
    loinc: loincSchema,
    start: windowStart,
    end: windowEnd,
  })
  .strict()
  .refine(startBeforeEnd, START_BEFORE_END)
  .describe(
    "A subject's latest value of one LOINC in a window, as a percentile among its synthetic cohort",
  );

/** FHIR R4 Condition.clinicalStatus codes. */
export const CONDITION_STATUSES = [
  "active",
  "recurrence",
  "relapse",
  "inactive",
  "remission",
  "resolved",
] as const;

/** FHIR R4 MedicationRequest.status codes. */
export const MEDICATION_REQUEST_STATUSES = [
  "active",
  "on-hold",
  "cancelled",
  "completed",
  "entered-in-error",
  "stopped",
  "draft",
  "unknown",
] as const;

/** A SNOMED CT, ICD-10 or RxNorm code as stored: letters, digits, dots and hyphens. */
const clinicalCodeSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9.-]{0,31}$/)
  .describe(
    "One code as recorded (SNOMED CT or ICD-10 for conditions, RxNorm for medications)",
  );

export const conditionsTimelineInput = z
  .object({
    subject_ref: subjectRefSchema,
    start: windowStart,
    end: windowEnd,
    status: z
      .enum(CONDITION_STATUSES)
      .optional()
      .describe("Only conditions with this recorded clinical status"),
    code: clinicalCodeSchema.optional(),
  })
  .strict()
  .refine(startBeforeEnd, START_BEFORE_END)
  .describe("Recorded conditions whose span overlaps a window, oldest onset first");

export const medicationsTimelineInput = z
  .object({
    subject_ref: subjectRefSchema,
    start: windowStart,
    end: windowEnd,
    status: z
      .enum(MEDICATION_REQUEST_STATUSES)
      .optional()
      .describe("Only medication requests with this recorded status"),
    code: clinicalCodeSchema.optional(),
  })
  .strict()
  .refine(startBeforeEnd, START_BEFORE_END)
  .describe("Recorded medication requests authored in a window, oldest first");

/** Which linked wearable a wearable tool reads; `all` reads each linked one, row by row. */
export const WEARABLE_SOURCE_CHOICES = ["oura", "whoop", "google", "all"] as const;

/** Sport groups `training_load` can keep; every vendor sport name falls in one. */
export const SPORT_GROUPS = [
  "running",
  "cycling",
  "walking",
  "swimming",
  "strength",
  "other",
] as const;

export const TRAINING_LOAD_AGGREGATIONS = ["day", "week"] as const;

const wearableSource = z
  .enum(WEARABLE_SOURCE_CHOICES)
  .describe(
    "oura, whoop or google: that linked source only; all: every linked source, each row naming its own",
  );

const wearableSubject = subjectRefSchema
  .optional()
  .describe(
    "Synthetic mode only: the subject_ref whose synthetic series to read. Leave it out in personal mode.",
  );

const wearableWindow = {
  subject_ref: wearableSubject,
  source: wearableSource,
  start: windowStart,
  end: windowEnd,
};

export const sleepSummaryInput = z
  .object(wearableWindow)
  .strict()
  .refine(startBeforeEnd, START_BEFORE_END)
  .describe("Main sleep per night from wearables in a window, per source");

export const hrvTrendInput = z
  .object(wearableWindow)
  .strict()
  .refine(startBeforeEnd, START_BEFORE_END)
  .describe("Trend of daily HRV from wearables in a window, per source");

export const restingHrTrendInput = z
  .object(wearableWindow)
  .strict()
  .refine(startBeforeEnd, START_BEFORE_END)
  .describe("Trend of daily resting heart rate from wearables in a window, per source");

export const trainingLoadInput = z
  .object({
    ...wearableWindow,
    sport: z
      .enum(SPORT_GROUPS)
      .optional()
      .describe("Keep only workouts of this sport group; left out, every workout"),
    aggregation: z
      .enum(TRAINING_LOAD_AGGREGATIONS)
      .describe("day: one row per day; week: one row per week starting Monday (UTC)"),
  })
  .strict()
  .refine(startBeforeEnd, START_BEFORE_END)
  .describe("Workout minutes per day or week from wearables in a window, per source");

/** Measures two wearables can both record, by day. */
export const COMPARE_MEASURES = [
  "hrv",
  "resting_hr",
  "sleep_duration",
  "sleep_efficiency",
] as const;

const singleWearable = z
  .enum(["oura", "whoop", "google"])
  .describe("A linked wearable: oura, whoop or google");

export const crossSourceCompareInput = z
  .object({
    measure: z
      .enum(COMPARE_MEASURES)
      .describe("hrv, resting_hr, sleep_duration or sleep_efficiency"),
    source_a: singleWearable,
    source_b: singleWearable,
    start: windowStart,
    end: windowEnd,
  })
  .strict()
  .refine(startBeforeEnd, START_BEFORE_END)
  .refine((input) => input.source_a !== input.source_b, {
    error: "source_a and source_b must be two different wearables",
  })
  .describe("How closely two linked wearables agree on one daily measure in a window");

export const valuesAroundEventInput = z
  .object({
    subject_ref: subjectRefSchema,
    loinc: loincSchema,
    event_kind: z
      .enum(["condition", "medication"])
      .describe("condition: its first recorded onset; medication: its first request"),
    event_code: clinicalCodeSchema.describe(
      "The condition's SNOMED CT or ICD-10 code, or the medication's RxNorm code, as recorded",
    ),
    days_before: z
      .number()
      .int()
      .min(1)
      .max(365)
      .describe("Days before the event, 1 to 365"),
    days_after: z
      .number()
      .int()
      .min(1)
      .max(365)
      .describe("Days from the event on, 1 to 365"),
  })
  .strict()
  .describe(
    "One LOINC's readings before and after a subject's first recorded condition or medication",
  );

export const TOOL_DEFINITIONS = [
  {
    name: "list_subjects",
    description: "List subject_ref values for a synthetic cohort. Max 200 rows.",
    input: listSubjectsInput,
  },
  {
    name: "subject_window",
    description:
      "Return the earliest and latest observation time and the row count for a subject.",
    input: subjectWindowInput,
  },
  {
    name: "observations_for_subject",
    description:
      "Return numeric observation rows for a subject, LOINC list, and time range. limit is 1–500.",
    input: observationsForSubjectInput,
  },
  {
    name: "latest_by_loinc",
    description:
      "Return the latest numeric row for each requested LOINC. Missing codes are omitted.",
    input: latestByLoincInput,
  },
  {
    name: "summary_stats",
    description: "Return n, min, max, mean, and unit_ucum for one LOINC in a time range.",
    input: summaryStatsInput,
  },
  {
    name: "trend",
    description:
      "Least-squares slope per day for one LOINC in a time range, with the fitted values at the first and last observation. slope_per_day is null when n < 3 or the rows span under 2 days. Reads up to 5000 rows; refuses mixed units.",
    input: trendInput,
  },
  {
    name: "baseline_deviation",
    description:
      "Robust z of the target-window median against a baseline window: (target median − baseline median) / (1.4826 × baseline MAD). robust_z is null when the MAD is 0 or a window has no rows. Up to 5000 rows per window; refuses mixed units.",
    input: baselineDeviationInput,
  },
  {
    name: "coverage",
    description:
      "For up to 20 LOINC codes in a time range: rows, UTC days with data, days in the window, coverage ratio, and the longest run of days without data. Reads up to 5000 rows; refuses mixed units.",
    input: coverageInput,
  },
  {
    name: "compare_windows",
    description:
      "n, mean, median, min, and max for one LOINC in window A and window B, and B minus A for each. Deltas are null when a window has no rows. Up to 5000 rows per window; refuses mixed units.",
    input: compareWindowsInput,
  },
  {
    name: "range_position",
    description:
      "Where one reading of one LOINC sits against its Anchor v3 published range: below, within or above it, bounds inclusive. pick latest takes the newest reading in the window, pick at the reading at `at`. A sex- or age-specific range is chosen from the subject's stored sex and birth year; facts_used names them, and the age is approximate (birth year only: one of two ages). When a fact is not stored (timing never is) or the age band changes within the reading's year, position is null and depends_on names the facts; nothing is guessed. Reads up to 5000 rows; refuses no rows, mixed units, no published range, and a unit other than the range's (nothing is converted). Neutral position only.",
    input: rangePositionInput,
  },
  {
    name: "convert_unit",
    description:
      "Convert one value of glucose, creatinine, HbA1c, total/LDL/HDL cholesterol, triglycerides or body temperature between units with a fixed table: value rounded half away from zero, unrounded, unit, the formula used and the rounding rule. Reads no rows. A pair the table does not hold is refused with UNSUPPORTED_CONVERSION and the pairs it does hold.",
    input: convertUnitInput,
  },
  {
    name: "cohort_position",
    description:
      'Where a subject\'s latest value of one LOINC in a time range sits among the latest values, in the same window, of everyone in its synthetic cohort (one value per person, the subject included). percentile is the mid-rank percentile, 100 × (n_lower + n_equal / 2) / n, where n is the people with a value and n_equal counts the subject; say it as "higher than about <percentile> % of the <n> synthetic people with a value", never better, worse or normal. Synthetic cohorts only. Refuses no value for the subject, fewer than 10 people with a value, mixed units across the cohort, and more than 20000 cohort rows (narrow the window).',
    input: cohortPositionInput,
  },
  {
    name: "conditions_timeline",
    description:
      "List one subject's recorded conditions whose span overlaps the window (onset at or before its end, and no abatement or abatement at or after its start), oldest onset first: code_system, code, display, onset_at, abatement_at, clinical_status and verification_status as recorded (status as of the record, not of the window), with n, n_codes, by_status and n_without_abatement. Optional status and code narrow the list. Reads up to 1000 records; refuses more (ROW_CAP_EXCEEDED) and none (NO_ROWS, with the reason). Lists what is recorded; times relate as before or after, never as a cause.",
    input: conditionsTimelineInput,
  },
  {
    name: "medications_timeline",
    description:
      "List one subject's recorded medication requests authored in the window, oldest first: code_system, code (RxNorm), display, authored_at, status and intent as recorded, and dosage_as_recorded, the record's own dosage text verbatim (null when the record has none), with n, n_codes, by_status and n_with_dosage_text. Optional status and code narrow the list. Reads up to 1000 records; refuses more (ROW_CAP_EXCEEDED) and none (NO_ROWS, with the reason). Lists what is recorded; never a dose, a change or advice of its own.",
    input: medicationsTimelineInput,
  },
  {
    name: "sleep_summary",
    description:
      "Main sleep per night in a window, one row per source and night: duration (min), time in bed (min, Whoop), efficiency (%) and the source's own sleep score, with each source's averages. Oura's main sleep is its long_sleep period; Whoop naps are left out. A field a source does not record is null. Personal mode: this turn's linked wearables, no subject_ref. Synthetic mode: the named subject's series, source all. Refuses SOURCE_NOT_CONNECTED, NO_ROWS and MIXED_UNITS.",
    input: sleepSummaryInput,
  },
  {
    name: "hrv_trend",
    description:
      "Daily HRV (RMSSD, ms) in a window, per source: n, least-squares slope per day and per week with the fitted first and last values, and the 7 days ending on end against the 28 days before them (medians, baseline MAD, robust z). Oura: average HRV in the main sleep; Whoop: recovery HRV. A source with fewer than 7 readings has null statistics; WINDOW_TOO_SHORT when none has 7. Personal mode: this turn's linked wearables, no subject_ref. Synthetic mode: the named subject's series, source all. Refuses SOURCE_NOT_CONNECTED, NO_ROWS, MIXED_UNITS and WINDOW_TOO_SHORT. Direction only, no judgement.",
    input: hrvTrendInput,
  },
  {
    name: "resting_hr_trend",
    description:
      "Daily resting heart rate in a window, per source: n, least-squares slope per day and per week with the fitted first and last values, and the 7 days ending on end against the 28 days before them (medians, baseline MAD, robust z). Whoop: recovery resting heart rate; Google Health: daily resting heart rate; the Oura summary holds none. A source with fewer than 7 readings has null statistics; WINDOW_TOO_SHORT when none has 7. Personal mode: this turn's linked wearables, no subject_ref. Synthetic mode: the named subject's series, source all. Refuses SOURCE_NOT_CONNECTED, NO_ROWS, MIXED_UNITS and WINDOW_TOO_SHORT. Direction only, no judgement.",
    input: restingHrTrendInput,
  },
  {
    name: "training_load",
    description:
      "Workouts in a window, one row per source, day or week (weeks start Monday, UTC) and sport: sessions, minutes, the highest workout strain (Whoop) and calories (Oura), null where a source does not record one. Per source also the minutes in the 7 days ending on end and in the 28 days before them, and their ratio, labelled only as recent load compared with the previous four weeks (null when those four weeks have no minutes). sport keeps one sport group. Personal mode: this turn's linked wearables, no subject_ref. Synthetic mode: the named subject's series, source all. Refuses SOURCE_NOT_CONNECTED, NO_ROWS and MIXED_UNITS. Numbers only, no advice.",
    input: trainingLoadInput,
  },
  {
    name: "cross_source_compare",
    description:
      "How closely two linked wearables agree on one daily measure (hrv, resting_hr, sleep_duration, sleep_efficiency) in a window, over the days both recorded: n_pairs, each source's mean, the mean difference (b minus a), its standard deviation, the limits of agreement (mean difference plus or minus 1.96 standard deviations) and the Pearson correlation. Under 7 paired days the spread, limits and correlation are null. Personal mode only; units must match and are never converted. Says how far apart the two read, never which is right. Refuses SOURCE_NOT_CONNECTED, NO_ROWS, MIXED_UNITS, UNIT_MISMATCH and WINDOW_TOO_SHORT.",
    input: crossSourceCompareInput,
  },
  {
    name: "values_around_event",
    description:
      "One subject's readings of one LOINC in the days_before days before and the days_after days from the first recorded onset of a condition (event_kind condition) or the first request of a medication (event_kind medication), found by its code: n, mean, median, min and max on each side and after minus before. Says what was recorded before and after the date, never that the event caused a change. Refuses SUBJECT_SCOPE_VIOLATION, NO_ROWS (no dated record of that code, or no reading on either side), MIXED_UNITS and ROW_CAP_EXCEEDED.",
    input: valuesAroundEventInput,
  },
] as const;
