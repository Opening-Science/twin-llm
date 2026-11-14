/**
 * WHAT: Zod (or typed) schema for a vendor/API payload shape.
 * NOT:  Must not map to FHIR or choose LOINC/UCUM; mappers and fhir-core own that.
GOVERNED BY: DECISIONS.md#d1; DECISIONS.md#d2; DECISIONS.md#d6
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 * GOTCHA: Schema optional fields are not discriminators for response type (ADR 0005).
 */
import { z } from 'zod';
import { ResponseParams } from './client';

const ActivityMetSchema = z.object({
  interval: z.number().nonnegative().optional(),
  items: z.array(z.number().nonnegative()),
  timestamp: z.iso.datetime({ offset: true }) // starting time, with the wearer's UTC offset
});

const ActivityContributorsSchema = z.object({
  meet_daily_targets: z.number().int().min(0).max(100).optional(),
  move_every_hour: z.number().int().min(0).max(100).optional(),
  recovery_time: z.number().int().min(0).max(100).optional(),
  stay_active: z.number().int().min(0).max(100).optional(),
  training_frequency: z.number().int().min(0).max(100).optional(),
  training_volume: z.number().int().min(0).max(100).optional()
});

const DailyActivityItemSchema = z.object({
  id: z.string().nonempty(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // Format: YYYY-MM-DD
  timestamp: z.iso.datetime({ offset: true }), // local midnight, with the wearer's UTC offset
  score: z.number().int().min(0).max(100).optional(),
  active_calories: z.number().int().nonnegative().optional(),
  average_met_minutes: z.number().optional(),
  class_5_min: z.string().optional(),
  contributors: ActivityContributorsSchema,
  equivalent_walking_distance: z.number().int().nonnegative().optional(),
  high_activity_met_minutes: z.number().int().nonnegative().optional(),
  high_activity_time: z.number().int().nonnegative().optional(),
  inactivity_alerts: z.number().int().nonnegative().optional(),
  low_activity_met_minutes: z.number().int().nonnegative().optional(),
  low_activity_time: z.number().int().nonnegative().optional(),
  medium_activity_met_minutes: z.number().int().nonnegative().optional(),
  medium_activity_time: z.number().int().nonnegative().optional(),
  met: ActivityMetSchema.optional(),
  meters_to_target: z.number().int().optional(),
  non_wear_time: z.number().int().nonnegative().optional(),
  resting_time: z.number().int().nonnegative().optional(),
  sedentary_met_minutes: z.number().int().nonnegative().optional(),
  sedentary_time: z.number().int().nonnegative().optional(),
  steps: z.number().int().nonnegative().optional(),
  target_calories: z.number().int().nonnegative().optional(),
  target_meters: z.number().int().nonnegative().optional(),
  total_calories: z.number().int().nonnegative().optional()
});

export const OuraDailyActivityResponseListSchema = ResponseParams.extend({
  data: z.array(DailyActivityItemSchema)
});

export type OuraDailyActivityResponseList = z.infer<typeof OuraDailyActivityResponseListSchema>;
export type OuraDailyActivityItem = z.infer<typeof DailyActivityItemSchema>;
