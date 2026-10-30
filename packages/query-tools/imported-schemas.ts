import { z } from "zod";

import {
  IMPORTED_DATASETS_TOOL,
  IMPORTED_LATEST_TOOL,
  IMPORTED_CONDITIONS_TOOL,
  IMPORTED_MEDICATIONS_TOOL,
  IMPORTED_TABLE_TOOL,
  IMPORTED_TREND_TOOL,
} from "./imported-names";
import {
  loincSchema,
  START_BEFORE_END,
  startBeforeEnd,
  windowEnd,
  windowStart,
} from "./schemas";

/**
 * Inputs of the imported-data tools (#181). Closed like the warehouse tools:
 * no free filter, no SQL. A series is one dataset's LOINC code, or one
 * dataset's series stored by name with no code (Oura and Whoop HRV is RMSSD,
 * not the SDNN that `80404-7` means, so it is stored by name). The two are
 * never read together.
 */

export const datasetIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/)
  .describe("dataset_id from imported_datasets");

/** Exact stored name, as imported_datasets lists it; matched whole, never searched. */
export const seriesNameSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[^\u0000-\u001f]+$/)
  .describe("Exact name of a series without a code, from imported_datasets");

export const importedDatasetsInput = z
  .object({})
  .strict()
  .describe("The person's imported datasets and the series in each");

export const importedLatestInput = z
  .object({
    loinc: z.array(loincSchema).min(1).max(20),
    dataset_id: datasetIdSchema.optional(),
  })
  .strict()
  .describe("Newest imported reading per LOINC");

const oneSeriesGiven = (input: { readonly loinc?: string; readonly name?: string }) =>
  input.loinc !== undefined || input.name !== undefined;

export const importedTrendInput = z
  .object({
    dataset_id: datasetIdSchema,
    loinc: loincSchema.optional(),
    name: seriesNameSchema.optional(),
    start: windowStart,
    end: windowEnd,
  })
  .strict()
  .refine(oneSeriesGiven, { message: "give loinc or name" })
  .refine(startBeforeEnd, START_BEFORE_END)
  .describe("Least-squares trend of one imported series in a window");

/** Rows one `imported_table` call returns at most, and its default. */
export const IMPORTED_TABLE_ROW_CAP = 200;
export const IMPORTED_TABLE_DEFAULT_ROWS = 50;
/** Columns one `imported_table` call may name. */
export const IMPORTED_TABLE_COLUMN_CAP = 20;

/** A column name exactly as imported_datasets lists it; matched whole, never searched. */
export const columnNameSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[^\u0000-\u001f]+$/)
  .describe("Exact column name from imported_datasets");

const distinct = (names: readonly string[]) => new Set(names).size === names.length;

export const importedTableInput = z
  .object({
    dataset_id: datasetIdSchema,
    columns: z
      .array(columnNameSchema)
      .min(1)
      .max(IMPORTED_TABLE_COLUMN_CAP)
      .refine(distinct, { message: "name each column once" }),
    limit: z
      .number()
      .int()
      .min(1)
      .max(IMPORTED_TABLE_ROW_CAP)
      .default(IMPORTED_TABLE_DEFAULT_ROWS),
  })
  .strict()
  .describe("Selected columns of one imported research table, first rows in file order");

export const importedConditionsInput = z
  .object({ dataset_id: datasetIdSchema })
  .strict()
  .describe("Conditions recorded in one imported FHIR dataset");

export const importedMedicationsInput = z
  .object({ dataset_id: datasetIdSchema })
  .strict()
  .describe("Medication requests recorded in one imported FHIR dataset");

export const IMPORTED_TOOL_DEFINITIONS = [
  {
    name: IMPORTED_DATASETS_TOOL,
    description:
      "The person's own imported datasets: id, kind, name, rows, date range, and each series (LOINC or name, unit, n). No values.",
    input: importedDatasetsInput,
  },
  {
    name: IMPORTED_LATEST_TOOL,
    description:
      "Newest imported reading per LOINC, with its dataset, unit as stored and date precision. Series stored by name are not included.",
    input: importedLatestInput,
  },
  {
    name: IMPORTED_TREND_TOOL,
    description:
      "Least-squares slope per day of one imported series (dataset_id and loinc or name) in a window. Up to 5000 rows; refuses mixed units and month or year dates.",
    input: importedTrendInput,
  },
  {
    name: IMPORTED_TABLE_TOOL,
    description:
      "Selected columns (exact names from imported_datasets) of one imported table, first rows in file order. At most 20 columns and 200 rows; long text cut at 200 characters.",
    input: importedTableInput,
  },
  {
    name: IMPORTED_CONDITIONS_TOOL,
    description:
      "Conditions in one imported FHIR dataset: code system, code, display, onset, abatement, clinical status. No notes. Up to 500.",
    input: importedConditionsInput,
  },
  {
    name: IMPORTED_MEDICATIONS_TOOL,
    description:
      "Medication requests in one imported FHIR dataset: code system, code, display, authored date, status. No dosage text or notes. Up to 500.",
    input: importedMedicationsInput,
  },
] as const;
