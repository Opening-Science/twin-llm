import { z } from "zod";

export const ingestReportSchema = z.object({
  inserted: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  unresolved: z.array(z.string()),
  nonNumeric: z.number().int().nonnegative(),
  /** True when this bundle's sha256 was already stored; nothing was written. */
  alreadyIngested: z.boolean(),
  rejected: z.object({ reason: z.string().min(1) }).optional(),
});

export type IngestReport = z.infer<typeof ingestReportSchema>;

export const emptyReport = (overrides: Partial<IngestReport> = {}): IngestReport =>
  ingestReportSchema.parse({
    inserted: 0,
    skipped: 0,
    unresolved: [],
    nonNumeric: 0,
    alreadyIngested: false,
    ...overrides,
  });
