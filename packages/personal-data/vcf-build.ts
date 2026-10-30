import { normaliseBuild } from "@/packages/genome-reference/build";

import type { GenomeBuildSource, ImportRefusal } from "./types";

/**
 * The build a VCF's header names, decided as the genome track decides it
 * (docs/genome.md, "Build mismatch"): GRCh38 or hg38 is read, GRCh37 or hg19
 * is refused as `BUILD_MISMATCH`, another build as `BUILD_UNKNOWN`, and a file
 * that names none is refused unless the owner set GENOME_ASSUME_BUILD=GRCh38.
 * The build is never guessed from contig names or lengths.
 *
 * Names come from `##reference=` (a build token in the value, such as
 * `GRCh38` in `file:///ref/GRCh38_full_analysis_set.fa`; a path with no build
 * token names none) and from `assembly=` in `##contig` lines.
 */

const BUILD_TOKEN =
  /(?:^|[^a-z0-9])((?:grch3[78]|hg19|hg38|b37)(?:\.p\d+)?)(?=[^a-z0-9]|$)/i;

const CONTIG_ASSEMBLY = /^##contig=<.*?[<,]assembly=("?)([^",>]+)\1[,>]/i;

/** The build names one header line gives: zero or one. */
export const buildNamesInLine = (line: string): readonly string[] => {
  if (/^##reference=/i.test(line)) {
    const token = BUILD_TOKEN.exec(line.slice("##reference=".length));
    return token === null ? [] : [token[1]!];
  }
  const assembly = CONTIG_ASSEMBLY.exec(line);
  return assembly === null ? [] : [assembly[2]!.trim()];
};

export type VcfBuildDecision =
  | Readonly<{ ok: true; build: "GRCh38"; source: GenomeBuildSource }>
  | Readonly<{ ok: false; refusal: ImportRefusal }>;

export const VCF_BUILD_REFUSALS = {
  mismatch: {
    code: "BUILD_MISMATCH",
    message:
      "This VCF is on GRCh37 (hg19). Only GRCh38 files are imported, because GRCh37 positions point at different bases.",
  },
  other: {
    code: "BUILD_UNKNOWN",
    message: "This VCF names a build other than GRCh38. Only GRCh38 files are imported.",
  },
  none: {
    code: "BUILD_UNKNOWN",
    message:
      "This VCF does not name its build, so it is not imported. Set GENOME_ASSUME_BUILD=GRCh38 only if you know the calls are GRCh38.",
  },
} as const satisfies Readonly<Record<string, ImportRefusal>>;

export const decideVcfBuild = (
  names: readonly string[],
  assumeBuild: "GRCh38" | null,
): VcfBuildDecision => {
  const builds = names.map(normaliseBuild);
  if (builds.includes("GRCh37"))
    return { ok: false, refusal: VCF_BUILD_REFUSALS.mismatch };
  if (builds.includes(null)) return { ok: false, refusal: VCF_BUILD_REFUSALS.other };
  if (builds.length > 0) return { ok: true, build: "GRCh38", source: "file" };
  return assumeBuild === "GRCh38"
    ? { ok: true, build: "GRCh38", source: "assumed" }
    : { ok: false, refusal: VCF_BUILD_REFUSALS.none };
};
