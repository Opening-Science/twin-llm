import { z } from "zod";

import {
  IMPORTED_DATASETS_TOOL,
  IMPORTED_LATEST_TOOL,
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
] as const;
