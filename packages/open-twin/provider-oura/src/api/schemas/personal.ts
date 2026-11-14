/**
 * WHAT: Zod (or typed) schema for a vendor/API payload shape.
 * NOT:  Must not map to FHIR or choose LOINC/UCUM; mappers and fhir-core own that.
GOVERNED BY: DECISIONS.md#d1; DECISIONS.md#d2; DECISIONS.md#d6
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 * GOTCHA: Schema optional fields are not discriminators for response type (ADR 0005).
 */
import { z } from 'zod';

export const PersonalSchema = z.object({
  id: z.string().nonempty(),
  age: z.number().int().min(0).optional().nullable(),
  weight: z.number().min(0).optional().nullable(),
  height: z.number().min(0).optional().nullable(),
  biological_sex: z.string().optional().nullable(),
  email: z.email().optional().nullable()
});

export type OuraPersonal = z.infer<typeof PersonalSchema>;
