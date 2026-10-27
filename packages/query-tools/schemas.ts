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
      "Where one reading of one LOINC sits against its Anchor v3 published range: below, within or above it, bounds inclusive. pick latest takes the newest reading in the window, pick at the reading at `at`. When the range depends on sex, age or timing, which the warehouse does not hold, position is null and depends_on names them; nothing is guessed. Reads up to 5000 rows; refuses no rows, mixed units, no published range, and a unit other than the range's (nothing is converted). Neutral position only.",
    input: rangePositionInput,
  },
  {
    name: "convert_unit",
    description:
      "Convert one value of glucose, creatinine, HbA1c, total/LDL/HDL cholesterol, triglycerides or body temperature between units with a fixed table: value rounded half away from zero, unrounded, unit, the formula used and the rounding rule. Reads no rows. A pair the table does not hold is refused with UNSUPPORTED_CONVERSION and the pairs it does hold.",
    input: convertUnitInput,
  },
  {
    name: "sleep_summary",
    description:
      "Main sleep per night in a window, one row per source and night: duration (min), time in bed (min, Whoop), efficiency (%) and the source's own sleep score, with each source's averages. Oura's main sleep is its long_sleep period; Whoop naps are left out. A field a source does not record is null. Personal mode reads the linked Oura, Whoop and Google Health snapshots of this turn (leave subject_ref out); synthetic mode reads the named subject's synthetic series (source all), whose rows are source synthetic. Refuses SOURCE_NOT_CONNECTED, NO_ROWS and MIXED_UNITS.",
    input: sleepSummaryInput,
  },
  {
    name: "hrv_trend",
    description:
      "Daily HRV (RMSSD, ms) in a window, per source: n, least-squares slope per day and per week with the fitted first and last values, and the 7 days ending on end against the 28 days before them (medians, baseline MAD, robust z). Oura: average HRV in the main sleep; Whoop: recovery HRV. A source with fewer than 7 readings has null statistics; WINDOW_TOO_SHORT when none has 7. Personal mode reads the linked Oura, Whoop and Google Health snapshots of this turn (leave subject_ref out); synthetic mode reads the named subject's synthetic series (source all), whose rows are source synthetic. Refuses SOURCE_NOT_CONNECTED, NO_ROWS, MIXED_UNITS and WINDOW_TOO_SHORT. Direction only, no judgement.",
    input: hrvTrendInput,
  },
  {
    name: "resting_hr_trend",
    description:
      "Daily resting heart rate in a window, per source: n, least-squares slope per day and per week with the fitted first and last values, and the 7 days ending on end against the 28 days before them (medians, baseline MAD, robust z). Whoop: recovery resting heart rate; Google Health: daily resting heart rate; the Oura summary holds none. A source with fewer than 7 readings has null statistics; WINDOW_TOO_SHORT when none has 7. Personal mode reads the linked Oura, Whoop and Google Health snapshots of this turn (leave subject_ref out); synthetic mode reads the named subject's synthetic series (source all), whose rows are source synthetic. Refuses SOURCE_NOT_CONNECTED, NO_ROWS, MIXED_UNITS and WINDOW_TOO_SHORT. Direction only, no judgement.",
    input: restingHrTrendInput,
  },
  {
    name: "training_load",
    description:
      "Workouts in a window, one row per source, day or week (weeks start Monday, UTC) and sport: sessions, minutes, the highest workout strain (Whoop) and calories (Oura), null where a source does not record one. Per source also the minutes in the 7 days ending on end and in the 28 days before them, and their ratio, labelled only as recent load compared with the previous four weeks (null when those four weeks have no minutes). sport keeps one sport group. Personal mode reads the linked Oura, Whoop and Google Health snapshots of this turn (leave subject_ref out); synthetic mode reads the named subject's synthetic series (source all), whose rows are source synthetic. Refuses SOURCE_NOT_CONNECTED, NO_ROWS and MIXED_UNITS. Numbers only, no advice.",
    input: trainingLoadInput,
  },
] as const;
