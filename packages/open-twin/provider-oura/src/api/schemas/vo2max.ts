/**
 * WHAT: Zod (or typed) schema for a vendor/API payload shape.
 * NOT:  Must not map to FHIR or choose LOINC/UCUM; mappers and fhir-core own that.
GOVERNED BY: DECISIONS.md#d1; DECISIONS.md#d2; DECISIONS.md#d6
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 * GOTCHA: Schema optional fields are not discriminators for response type (ADR 0005).
 */
import { z } from 'zod';
import { ResponseParams } from './client';

export const VO2MaxSchema = z.object({
  id: z.string().nonempty(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // Format: YYYY-MM-DD
  timestamp: z.iso.datetime({ offset: true }), // with the wearer's UTC offset
  vo2_max: z.number().optional()
});

export const VO2MaxListSchema = ResponseParams.extend({
  data: z.array(VO2MaxSchema)
});

export type OuraVO2MaxResponseList = z.infer<typeof VO2MaxListSchema>;
export type OuraVO2MaxItem = z.infer<typeof VO2MaxSchema>;
