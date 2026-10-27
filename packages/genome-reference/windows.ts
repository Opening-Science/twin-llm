/**
 * Reference and alternate DNA windows around one reported site, from a slice
 * of the public GRCh38 sequence. Pure: `read-fasta.ts` does the file I/O.
 *
 * Nothing here comes from the Ark except the report's coordinates, reference
 * allele and genotype. The sequence context is the public reference; the
 * alternate window is that context with the reported allele swapped in.
 *
 * The reference allele must match the FASTA at that position. A mismatch
 * means a different build, a strand flip or a bad call, and every one of
 * those would send the model a wrong sequence, so it refuses instead.
 */

export const DEFAULT_FLANK = 256;
export const MAX_FLANK = 4096;

const COMPLEMENT: Readonly<Record<string, string>> = { A: "T", C: "G", G: "C", T: "A" };

export const reverseComplement = (sequence: string): string =>
  [...sequence.toUpperCase()]
    .reverse()
    .map((base) => COMPLEMENT[base] ?? "N")
    .join("");

export type WindowRequest = Readonly<{
  chromosome: string;
  /** 1-based position of the reference allele's first base. */
  position: number;
  reference: string;
  /** Alleles to swap in; the reference itself and duplicates are dropped. */
  alternates: readonly string[];
  flank: number;
}>;

/** The 0-based, end-exclusive span to read for a request. */
export const sliceSpan = (
  request: Pick<WindowRequest, "position" | "reference" | "flank">,
): Readonly<{ start: number; end: number }> => {
  const site = request.position - 1;
  return {
    start: Math.max(0, site - request.flank),
    end: site + request.reference.length + request.flank,
  };
};

export type DnaWindow = Readonly<{
  allele: string;
  /** Upper-case bases, flank + allele + flank (shorter at a chromosome end). */
  sequence: string;
}>;

export type ReferenceWindows = Readonly<{
  chromosome: string;
  position: number;
  flank: number;
  /** 1-based position of the window's first base. */
  windowStart: number;
  reference: DnaWindow;
  alternates: readonly DnaWindow[];
}>;

export type WindowRefusal = Readonly<{
  code: "REF_MISMATCH" | "REF_STRAND_MISMATCH" | "OUT_OF_RANGE";
  error: string;
}>;

export const isWindowRefusal = (
  value: ReferenceWindows | WindowRefusal,
): value is WindowRefusal => "code" in value;

/**
 * Builds the windows from `slice`, which holds the bases from `sliceStart`
 * (0-based) on, as `sliceSpan` asked for them.
 */
export const buildWindows = (
  request: WindowRequest,
  slice: string,
  sliceStart: number,
): ReferenceWindows | WindowRefusal => {
  const sequence = slice.toUpperCase();
  const reference = request.reference.toUpperCase();
  const offset = request.position - 1 - sliceStart;
  const found = sequence.slice(offset, offset + reference.length);
  if (offset < 0 || found.length !== reference.length) {
    return {
      code: "OUT_OF_RANGE",
      error: `${request.chromosome}:${request.position} is past the end of the reference chromosome`,
    };
  }
  if (found !== reference) {
    return found === reverseComplement(reference)
      ? {
          code: "REF_STRAND_MISMATCH",
          error: `the report's reference allele ${reference} is the reverse complement of GRCh38's ${found}; the call file is on the other strand`,
        }
      : {
          code: "REF_MISMATCH",
          error: `the report's reference allele ${reference} does not match GRCh38's ${found} at ${request.chromosome}:${request.position}`,
        };
  }
  const left = sequence.slice(0, offset);
  const right = sequence.slice(offset + reference.length);
  const alternates = [
    ...new Set(
      request.alternates
        .map((allele) => (allele === "-" ? "" : allele.toUpperCase()))
        .filter((allele) => allele !== reference),
    ),
  ];
  return {
    chromosome: request.chromosome,
    position: request.position,
    flank: request.flank,
    windowStart: sliceStart + 1,
    reference: { allele: reference, sequence },
    alternates: alternates.map((allele) => ({
      allele: allele === "" ? "-" : allele,
      sequence: `${left}${allele}${right}`,
    })),
  };
};
