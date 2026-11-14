/**
 * WHAT: Zod (or typed) schema for a vendor/API payload shape.
 * NOT:  Must not map to FHIR or choose LOINC/UCUM; mappers and fhir-core own that.
GOVERNED BY: DECISIONS.md#d1; DECISIONS.md#d2; DECISIONS.md#d6
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 * GOTCHA: Schema optional fields are not discriminators for response type (ADR 0005).
 */
import { z } from 'zod';
import { ResponseParams } from './client';

export const Spo2Schema = z.object({
  id: z.string().nonempty(),
  breathing_disturbance_index: z.number().min(0).max(100).nullable(),
  spo2_percentage: z.object({ average: z.number().min(0).max(100) }).nullable(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) // Format: YYYY-MM-DD
});

export const Spo2ListSchema = ResponseParams.extend({
  data: z.array(Spo2Schema)
});

export type OuraSpo2 = z.infer<typeof Spo2Schema>;
export type OuraSpo2List = z.infer<typeof Spo2ListSchema>;
