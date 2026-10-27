/**
 * Which assembly a report's coordinates are on. The windows come from a
 * GRCh38 FASTA, so a GRCh37 (hg19) position would point at the wrong bases:
 * the same rsID sits about 1.8 Mb away on chr10. The build is never guessed.
 *
 * Order: the build the Ark names for its call slot, else the owner's explicit
 * `GENOME_ASSUME_BUILD=GRCh38`. GRCh37 refuses; anything unknown refuses.
 */

export const REFERENCE_BUILD = "GRCh38" as const;

export type KnownBuild = "GRCh38" | "GRCh37";

/** `hg38`, `GRCh38.p14`, `grch38` → GRCh38; `hg19`, `GRCh37.p13`, `b37` → GRCh37. */
export const normaliseBuild = (raw: string | null | undefined): KnownBuild | null => {
  if (raw == null) return null;
  const value = raw.trim().toLowerCase();
  if (/^(grch38|hg38)(\.p\d+)?$/.test(value)) return "GRCh38";
  if (/^(grch37|hg19|b37)(\.p\d+)?$/.test(value)) return "GRCh37";
  return null;
};

export type BuildDecision =
  | Readonly<{ ok: true; build: typeof REFERENCE_BUILD; source: "ark" | "assumed" }>
  | Readonly<{ ok: false; code: "BUILD_MISMATCH" | "BUILD_UNKNOWN"; error: string }>;

export const BUILD_MISMATCH_ERROR =
  "the report is on GRCh37 and the reference windows are GRCh38, so the positions do not match";

export const BUILD_UNKNOWN_ERROR =
  "the Ark did not name the report's build; set GENOME_ASSUME_BUILD=GRCh38 only if you know the calls are GRCh38";

export const decideBuild = (
  input: Readonly<{ arkBuild: string | null; assumeBuild: "GRCh38" | null }>,
): BuildDecision => {
  const fromArk = normaliseBuild(input.arkBuild);
  if (fromArk === "GRCh38") return { ok: true, build: REFERENCE_BUILD, source: "ark" };
  if (fromArk === "GRCh37") {
    return { ok: false, code: "BUILD_MISMATCH", error: BUILD_MISMATCH_ERROR };
  }
  if (input.arkBuild !== null && input.arkBuild.trim() !== "") {
    // The Ark named a build we do not know: never override it with an assumption.
    return { ok: false, code: "BUILD_UNKNOWN", error: BUILD_UNKNOWN_ERROR };
  }
  return input.assumeBuild === "GRCh38"
    ? { ok: true, build: REFERENCE_BUILD, source: "assumed" }
    : { ok: false, code: "BUILD_UNKNOWN", error: BUILD_UNKNOWN_ERROR };
};
