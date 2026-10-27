import "server-only";

import { readFastaSpan } from "./read-fasta";
import {
  buildWindows,
  DEFAULT_FLANK,
  MAX_FLANK,
  type ReferenceWindows,
  sliceSpan,
  type WindowRefusal,
  type WindowRequest,
} from "./windows";

export {
  BUILD_MISMATCH_ERROR,
  BUILD_UNKNOWN_ERROR,
  decideBuild,
  normaliseBuild,
  REFERENCE_BUILD,
  type BuildDecision,
} from "./build";
export {
  DEFAULT_FLANK,
  isWindowRefusal,
  MAX_FLANK,
  reverseComplement,
  type DnaWindow,
  type ReferenceWindows,
  type WindowRefusal,
} from "./windows";

export type ReferenceRefusal =
  | WindowRefusal
  | Readonly<{
      code: "REFERENCE_MISSING" | "REFERENCE_UNREADABLE" | "REFERENCE_NOT_CONFIGURED";
      error: string;
    }>;

/**
 * Ref and alt windows for one site from the GRCh38 FASTA in `dir`, or why
 * not. The flank is clamped to 1..MAX_FLANK.
 */
export const referenceWindows = async (
  dir: string | null,
  request: Omit<WindowRequest, "flank"> & Readonly<{ flank?: number }>,
): Promise<ReferenceWindows | ReferenceRefusal> => {
  if (dir === null) {
    return {
      code: "REFERENCE_NOT_CONFIGURED",
      error: "GENOME_REFERENCE_DIR is not set, so there is no public reference to read",
    };
  }
  const flank = Math.min(
    MAX_FLANK,
    Math.max(1, Math.floor(request.flank ?? DEFAULT_FLANK)),
  );
  const full: WindowRequest = { ...request, flank };
  const span = sliceSpan(full);
  const read = await readFastaSpan(dir, { chromosome: request.chromosome, ...span });
  if (!read.ok) return { code: read.code, error: read.error };
  return buildWindows(full, read.bases, span.start);
};
