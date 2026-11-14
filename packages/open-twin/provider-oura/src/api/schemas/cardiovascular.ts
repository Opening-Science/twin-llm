/**
 * WHAT: Zod (or typed) schema for a vendor/API payload shape.
 * NOT:  Must not map to FHIR or choose LOINC/UCUM; mappers and fhir-core own that.
GOVERNED BY: DECISIONS.md#d1; DECISIONS.md#d2; DECISIONS.md#d6
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 * GOTCHA: Schema optional fields are not discriminators for response type (ADR 0005).
 */
import { z } from 'zod';
import { ResponseParams } from './client';

// Only `id` and `day` are required by Oura's published spec, so the two
// measurements are optional as well as nullable: `.nullable()` alone throws when
// the key is absent, which the contract permits.
export const CardiovascularAgeSchema = z.object({
  id: z.string().nonempty(),
  pulse_wave_velocity: z.number().nullable().optional(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // Format: YYYY-MM-DD
  vascular_age: z.number().nullable().optional()
});

export const CardiovascularAgeListSchema = ResponseParams.extend({
  data: z.array(CardiovascularAgeSchema)
});

export type OuraCardiovascularAge = z.infer<typeof CardiovascularAgeSchema>;
export type OuraCardiovascularAgeList = z.infer<typeof CardiovascularAgeListSchema>;
