/**
 * WHAT: Zod (or typed) schema for a vendor/API payload shape.
 * NOT:  Must not map to FHIR or choose LOINC/UCUM; mappers and fhir-core own that.
GOVERNED BY: DECISIONS.md#d1; DECISIONS.md#d2; DECISIONS.md#d6
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 * GOTCHA: Schema optional fields are not discriminators for response type (ADR 0005).
 */
import { z } from 'zod';
import { ResponseParams } from './client';

export const RestModeSchema = z.object({
  id: z.string().nonempty(),
  end_day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(), // Format: YYYY-MM-DD
  end_time: z.string(),
  start_day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(), // Format: YYYY-MM-DD
  start_time: z.string(),
  episodes: z
    .array(
      z.object({
        tag: z.array(z.string()).optional(),
        timestamp: z.string()
      })
    )
    .optional()
});

export const RestModeListSchema = ResponseParams.extend({
  data: z.array(RestModeSchema)
});

export type OuraRestMode = z.infer<typeof RestModeSchema>;
export type OuraRestModeList = z.infer<typeof RestModeListSchema>;
