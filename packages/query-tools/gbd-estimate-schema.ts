import { z } from "zod";

import {
  GBD_AGE_IDS,
  GBD_ESTIMATE_TOOL,
  GBD_FIRST_YEAR,
  GBD_LAST_YEAR,
  GBD_LIFE_TABLE_MEASURES,
  GBD_MEASURE_IDS,
  GBD_METRIC_IDS,
  GBD_SEX_IDS,
} from "@/packages/gbd-local/constants";

const keys = <T extends Record<string, unknown>>(record: T) =>
  Object.keys(record) as [keyof T & string, ...(keyof T & string)[]];

// Bounds as a pattern and refinements: zod enforces them, and the model's
// copy of the schema (modelJsonSchema) leaves them out to save prompt room.
const place = z.string().regex(/^[^\n]{1,120}$/);

const between = (min: number, max: number) => (items: readonly unknown[]) =>
  items.length >= min && items.length <= max;

/**
 * `gbd_estimate` (#387): closed fields over the imported GBD 2023 results.
 * Cause and risk are the names IHME uses ("Cardiovascular diseases", "High
 * systolic blood pressure"); places are GBD names or ISO codes. Exactly one
 * of `locations`, `children_of` or `sdi`. HALE and life expectancy (#394)
 * are about no cause: metric years, no cause or risk; `at_birth` is theirs.
 */
export const gbdEstimateInput = z
  .object({
    measure: z.enum(keys(GBD_MEASURE_IDS)),
    metric: z.enum(keys(GBD_METRIC_IDS)),
    cause: place.optional(),
    risk: place.optional(),
    locations: z.array(place).refine(between(1, 10)).optional(),
    children_of: place.optional(),
    sdi: z.literal(true).optional(),
    sex: z.enum(keys(GBD_SEX_IDS)),
    age: z.enum(keys(GBD_AGE_IDS)),
    years: z
      .array(z.number())
      .refine(between(1, 10))
      .refine((years) =>
        years.every(
          (year) =>
            Number.isInteger(year) && year >= GBD_FIRST_YEAR && year <= GBD_LAST_YEAR,
        ),
      ),
  })
  .strict()
  .refine(
    (input) =>
      GBD_LIFE_TABLE_MEASURES.has(input.measure)
        ? input.metric === "years" &&
          input.cause === undefined &&
          input.risk === undefined
        : input.metric !== "years" && input.age !== "at_birth",
    {
      message:
        "hale and life_expectancy take metric years and no cause or risk; at_birth and years are theirs only",
    },
  )
  .refine(
    (input) =>
      GBD_LIFE_TABLE_MEASURES.has(input.measure) ||
      input.cause !== undefined ||
      input.risk !== undefined,
    { message: "give cause, risk or both" },
  )
  .refine(
    (input) =>
      [input.locations, input.children_of, input.sdi].filter(
        (choice) => choice !== undefined,
      ).length === 1,
    { message: "give exactly one of locations, children_of or sdi" },
  )
  .describe("IHME GBD 2023 estimates imported on this machine");

export type GbdEstimateInput = z.infer<typeof gbdEstimateInput>;

export const GBD_ESTIMATE_TOOL_DEFINITION = {
  name: GBD_ESTIMATE_TOOL,
  description:
    "IHME GBD population estimates, never about one person. Lead with hale, life_expectancy (years, no cause); deaths if asked. Others: cause or risk (IHME names).",
  input: gbdEstimateInput,
} as const;
