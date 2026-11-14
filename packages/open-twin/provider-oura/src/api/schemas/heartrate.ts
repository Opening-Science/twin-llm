/**
 * WHAT: Zod (or typed) schema for a vendor/API payload shape.
 * NOT:  Must not map to FHIR or choose LOINC/UCUM; mappers and fhir-core own that.
GOVERNED BY: DECISIONS.md#d1; DECISIONS.md#d2; DECISIONS.md#d6
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 * GOTCHA: Schema optional fields are not discriminators for response type (ADR 0005).
 */
import { z } from 'zod';
import { ResponseParams } from './client';

export const HeartRateSchema = z.object({
  timestamp: z.iso.datetime({ offset: true }),
  timestamp_unix: z.number().optional(), // UNIX time in MILLISECONDS, per Oura's spec
  bpm: z.number(),
  source: z.enum(['awake', 'workout', 'rest', 'sleep', 'live', 'session'])
});

export const HeartRateListSchema = ResponseParams.extend({
  data: z.array(HeartRateSchema)
});

export type OuraHeartRate = z.infer<typeof HeartRateSchema>;
export type OuraHeartRateList = z.infer<typeof HeartRateListSchema>;
