import { z } from "zod";

export const VITRONIC_SELF_LABEL = "Self";
export const VITRONIC_SUBJECT_SOURCE_SCANNER = "scanner";
export const LABEL_HINT = "not a name";

export const createSubjectSchema = z.object({
  label: z.string().trim().min(1),
  source: z.string().trim().min(1),
  isSelf: z.boolean().optional(),
  probandId: z.coerce.number().int().positive().optional(),
  consentRecordedAt: z.string().trim().min(1),
  consentBy: z.string().trim().min(1),
  consentNote: z.string().trim().min(1),
});

export type CreateSubjectInput = z.infer<typeof createSubjectSchema>;

/** `null` clears the pin so the viewer falls back to the newest synced scan. */
export const defaultScanSchema = z.object({
  viatarId: z.number().int().positive().nullable(),
});

export const parseConsentTime = (value: string): Date | null => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed);
};
