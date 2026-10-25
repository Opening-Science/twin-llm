import { z } from "zod";

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
] as const;
