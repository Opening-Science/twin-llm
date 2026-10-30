/**
 * The LOINC codes the pinned cohort holds (`evaluation/cohort-codes.v1.json`,
 * #276), so the call-accuracy scorer can tell a code the cohort has no
 * reading for from a valid one without a database. Built by
 * `build-cohort-codes.ts`. Codes only: no value, date or subject. Pure.
 */
import { z } from "zod";

import { COHORT_ID } from "./question-set";

export const LOINC_SHAPE = /^\d{1,5}-\d$/;

export const COHORT_CODES_PATH = "evaluation/cohort-codes.v1.json";

export const cohortCodesSchema = z
  .object({
    schema_version: z.literal("twin-llm.eval.cohort-codes.v1"),
    cohort_id: z.literal(COHORT_ID),
    /** The Synthea patient files' `contentSha256`, as the answer key pins it. */
    content_sha256: z.string().regex(/^[0-9a-f]{64}$/),
    /** The synthetic wearable series the codes include. */
    wearables: z
      .object({
        generator_version: z.string(),
        seed: z.number().int(),
        end_day: z.iso.date(),
        days: z.number().int().positive(),
      })
      .strict(),
    codes: z.array(z.string().regex(LOINC_SHAPE)),
  })
  .strict();

export type CohortCodes = z.infer<typeof cohortCodesSchema>;
