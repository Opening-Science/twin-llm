/**
 * WHAT: Zod (or typed) schema for a vendor/API payload shape.
 * NOT:  Must not map to FHIR or choose LOINC/UCUM; mappers and fhir-core own that.
GOVERNED BY: DECISIONS.md#d1; DECISIONS.md#d2; DECISIONS.md#d6
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 * GOTCHA: Schema optional fields are not discriminators for response type (ADR 0005).
 */
import { z } from 'zod';
import { SUPPORTED_SCOPES } from '../../config/constants';

/**
 * Oura's list endpoints accept `YYYY-MM-DD` (and full RFC 3339), confirmed against
 * the published OpenAPI 3.1 spec and the live sandbox.
 *
 * The regex used to be `/^\d{2}.\d{2}.\d{4}$/` with the comment "Format:
 * DD.MM.YYYY". It rejected `2026-12-31`, accepted `99.99.9999`, and — because `.`
 * is unescaped — accepted `12X31X2026` too. It never fired, because nothing ever
 * parsed this schema; `requestOuraData` now does, which is a behaviour change:
 * a malformed date is rejected here instead of reaching Oura.
 */
export const RequestParamsSchema = z.object({
  types: z.array(z.enum([...SUPPORTED_SCOPES])).min(1),
  start_date: z.iso.date().optional(),
  end_date: z.iso.date().optional(),
  /**
   * The wearer's UTC offset, e.g. '+03:00'. Used to widen a bare date into the
   * datetime window the `heartrate` endpoints require.
   *
   * Optional, and omitting it assumes UTC — which is wrong for any wearer not
   * on UTC. It is explicit rather than hidden so a caller can correct it; the
   * previous behaviour hardcoded +00:00 with no way to override.
   */
  utc_offset: z
    .string()
    .regex(/^[+-]\d{2}:\d{2}$/)
    .optional(),
  next_token: z.string().nullable().optional(),
  fields: z.array(z.string()).optional(),
  latest: z.boolean().nullable().optional()
});

/**
 * `data` was `z.any()`, which made every property access on a response an
 * unchecked `any`: `data[0].workout_type` type-checked under --strict even though
 * no schema has that field, and the connector shipped a discriminator on it.
 */
export const ResponseParams = z.object({
  data: z.array(z.record(z.string(), z.unknown())),
  next_token: z.string().nullable().optional()
});

export type RequestParams = z.infer<typeof RequestParamsSchema>;
export type OuraResponseParams = z.infer<typeof ResponseParams>;
