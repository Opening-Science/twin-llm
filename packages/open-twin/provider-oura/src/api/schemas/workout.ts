/**
 * WHAT: Zod (or typed) schema for a vendor/API payload shape.
 * NOT:  Must not map to FHIR or choose LOINC/UCUM; mappers and fhir-core own that.
GOVERNED BY: DECISIONS.md#d1; DECISIONS.md#d2; DECISIONS.md#d6
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 * GOTCHA: Schema optional fields are not discriminators for response type (ADR 0005).
 */
import { z } from 'zod';
import { ResponseParams } from './client';

export const WorkoutSchema = z.object({
  id: z.string().nonempty(),
  activity: z.string(),
  source: z.literal(['manual', 'autodetected', 'confirmed', 'workout_heart_rate']),
  intensity: z.literal(['easy', 'moderate', 'hard']),
  start_datetime: z.iso.datetime({ offset: true }),
  end_datetime: z.iso.datetime({ offset: true }),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // Format: YYYY-MM-DD
  // Nullable *and* optional: Oura's spec lists only id, activity, day,
  // start_datetime, end_datetime, intensity and source as required.
  calories: z.number().nullable().optional(),
  distance: z.number().nullable().optional(),
  label: z.string().nullable().optional()
});

export const WorkoutListSchema = ResponseParams.extend({
  data: z.array(WorkoutSchema)
});

export type OuraWorkout = z.infer<typeof WorkoutSchema>;
export type OuraWorkoutList = z.infer<typeof WorkoutListSchema>;
