/**
 * WHAT: Zod (or typed) schema for a vendor/API payload shape.
 * NOT:  Must not map to FHIR or choose LOINC/UCUM; mappers and fhir-core own that.
GOVERNED BY: DECISIONS.md#d1; DECISIONS.md#d2; DECISIONS.md#d6
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 * GOTCHA: Schema optional fields are not discriminators for response type (ADR 0005).
 */
import { z } from 'zod';
import { ResponseParams } from './client';

const PublicSampleSchema = z.object({
  interval: z.number(),
  items: z.array(z.number()).nullable(),
  timestamp: z.string()
});

export const SessionSchema = z.object({
  id: z.string().min(1),
  day: z.string(),
  end_datetime: z.string(),
  heart_rate: PublicSampleSchema.nullable(),
  heart_rate_variability: PublicSampleSchema.nullable(),
  mood: z.enum(['bad', 'worse', 'same', 'good', 'great']).nullable(),
  motion_count: PublicSampleSchema.nullable(),
  start_datetime: z.string(),
  type: z.enum(['breathing', 'meditation', 'nap', 'relaxation', 'rest', 'body_status'])
});

export const SessionListSchema = ResponseParams.extend({
  data: z.array(SessionSchema)
});

export type Session = z.infer<typeof SessionSchema>;
export type PublicSample = z.infer<typeof PublicSampleSchema>;
export type SessionList = z.infer<typeof SessionListSchema>;
