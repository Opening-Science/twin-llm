/**
 * WHAT: Zod (or typed) schema for a vendor/API payload shape.
 * NOT:  Must not map to FHIR or choose LOINC/UCUM; mappers and fhir-core own that.
GOVERNED BY: DECISIONS.md#d1; DECISIONS.md#d2; DECISIONS.md#d6
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 * GOTCHA: Schema optional fields are not discriminators for response type (ADR 0005).
 */
import { z } from 'zod';
import { ResponseParams } from './client';

export const StressSchema = z.object({
  id: z.string().nonempty(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // Format: YYYY-MM-DD
  day_summary: z.enum(['restored', 'normal', 'stressful']).optional().nullable(),
  recovery_high: z.number().int().optional().nullable(),
  stress_high: z.number().int().optional().nullable()
});

export const StressListSchema = ResponseParams.extend({
  data: z.array(StressSchema)
});

export type OuraStress = z.infer<typeof StressSchema>;
export type OuraStressList = z.infer<typeof StressListSchema>;
