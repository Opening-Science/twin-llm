/**
 * WHAT: Zod (or typed) schema for a vendor/API payload shape.
 * NOT:  Must not map to FHIR or choose LOINC/UCUM; mappers and fhir-core own that.
GOVERNED BY: DECISIONS.md#d1; DECISIONS.md#d2; DECISIONS.md#d6
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 * GOTCHA: Schema optional fields are not discriminators for response type (ADR 0005).
 */
import { z } from 'zod';
import { ResponseParams } from './client';

const SleepSchema = z.object({
  id: z.string().nonempty(),
  bedtime_start: z.string(),
  bedtime_end: z.string(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // Format: YYYY-MM-DD
  timestamp: z.string().optional().nullable(),
  score: z.number().int().min(0).max(100).optional().nullable(),

  average_breath: z.number().optional().nullable(),
  average_heart_rate: z.number().optional().nullable(),
  average_hrv: z.number().optional().nullable(),
  awake_time: z.number().int().nonnegative().optional().nullable(),
  deep_sleep_duration: z.number().int().nonnegative().optional().nullable(),
  efficiency: z.number().int().min(0).max(100).optional().nullable(),
  heart_rate: z.record(z.string(), z.unknown()).optional().nullable(),
  hrv: z.record(z.string(), z.unknown()).optional().nullable(),
  latency: z.number().int().nonnegative().optional().nullable(),
  light_sleep_duration: z.number().int().nonnegative().optional().nullable(),
  low_battery_alert: z.boolean().optional().nullable(),
  lowest_heart_rate: z.number().int().nonnegative().optional().nullable(),
  movement_30_sec: z.string().optional().nullable(),
  period: z.number().int().optional().nullable(),
  readiness: z.record(z.string(), z.unknown()).optional().nullable(),

  readiness_score_delta: z.number().optional().nullable(),
  rem_sleep_duration: z.number().int().nonnegative().optional().nullable(),
  restless_periods: z.number().int().nonnegative().optional().nullable(),
  sleep_algorithm_version: z.string().optional().nullable(),
  sleep_analysis_reason: z.string().optional().nullable(),
  sleep_phase_30_sec: z.string().optional().nullable(),
  sleep_phase_5_min: z.string().optional().nullable(),
  sleep_score_delta: z.number().optional().nullable(),
  time_in_bed: z.number().int().nonnegative().optional().nullable(),
  total_sleep_duration: z.number().int().nonnegative().optional().nullable(),
  type: z.enum(['long_sleep', 'rest', 'deleted', 'sleep', 'late_nap']).optional().nullable(),
  ring_id: z.string().optional().nullable(),
  app_sleep_phase_5_min: z.string().optional().nullable(),
  temperature_deviation: z.number().optional().nullable(),
  temperature_trend_deviation: z.number().optional().nullable()
});

export const SleepListSchema = ResponseParams.extend({
  data: z.array(SleepSchema)
});

export type OuraSleepList = z.infer<typeof SleepListSchema>;
export type OuraSleep = z.infer<typeof SleepSchema>;
