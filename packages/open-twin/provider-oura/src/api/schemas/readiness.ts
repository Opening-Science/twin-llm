/**
 * WHAT: Zod (or typed) schema for a vendor/API payload shape.
 * NOT:  Must not map to FHIR or choose LOINC/UCUM; mappers and fhir-core own that.
GOVERNED BY: DECISIONS.md#d1; DECISIONS.md#d2; DECISIONS.md#d6
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 * GOTCHA: Schema optional fields are not discriminators for response type (ADR 0005).
 */
import { z } from 'zod';
import { ResponseParams } from './client';

export const ReadinessContributorsSchema = z.object({
  activity_balance: z.number().int().min(0).max(100).optional().nullable(),
  hrv_balance: z.number().int().min(0).max(100).optional().nullable(),
  previous_day_activity: z.number().int().min(0).max(100).optional().nullable(),
  previous_night: z.number().int().min(0).max(100).optional().nullable(),
  recovery_index: z.number().int().min(0).max(100).optional().nullable(),
  resting_heart_rate: z.number().int().min(0).max(100).optional().nullable(),
  sleep_balance: z.number().int().min(0).max(100).optional().nullable(),
  sleep_regularity: z.number().int().min(0).max(100).optional().nullable()
});

export const ReadinessItemSchema = z.object({
  id: z.string().nonempty(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // Format: YYYY-MM-DD
  timestamp: z.iso.datetime({ offset: true }), // local midnight, with the wearer's UTC offset
  score: z.number().int().min(0).max(100).optional().nullable(),
  contributors: ReadinessContributorsSchema,
  temperature_deviation: z.number().optional().nullable(),
  temperature_trend_deviation: z.number().optional().nullable()
});

export const OuraReadinessResponseListSchema = ResponseParams.extend({
  data: z.array(ReadinessItemSchema)
});

export type OuraReadinessResponseList = z.infer<typeof OuraReadinessResponseListSchema>;
export type OuraReadinessItem = z.infer<typeof ReadinessItemSchema>;
