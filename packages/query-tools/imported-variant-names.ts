/**
 * The names `genome_variants` (#307) accepts, and how a stored VCF record is
 * matched to one. Pure and free of zod.
 *
 * A name is an rsID (`rs4244285`) or one GRCh38 site (`chr10:94781859`).
 * Nothing else: no range, no gene, no wildcard, so the tool can only look up
 * what was named and never scan the file.
 */

/** Names one call may look up. More is refused, not cut. */
export const MAX_VARIANT_NAMES = 50;

/** Records one call may return. More is refused, not cut. */
export const MAX_VARIANT_RECORDS = 200;

const RSID_NAME = /^rs[1-9]\d{0,11}$/;
const SITE_NAME = /^chr([1-9]|1\d|2[0-2]|X|Y|M|MT):([1-9]\d{0,9})$/;
/** Positions are stored in a 32-bit column. */
const MAX_POSITION = 2_147_483_647;

export type VariantName =
  | Readonly<{ kind: "rsid"; name: string; rsid: string }>
  /** `chrom` without `chr`, `MT` read as `M`. */
  | Readonly<{ kind: "site"; name: string; chrom: string; pos: number }>;

/** A chromosome name as a VCF may write it, reduced to `1` … `22`, `X`, `Y` or `M`. */
export const canonicalChrom = (chrom: string): string => {
  const bare = chrom.replace(/^chr/i, "").toUpperCase();
  return bare === "MT" ? "M" : bare;
};

/** One name, or null when it is neither an rsID nor `chrN:pos`. */
export const parseVariantName = (name: string): VariantName | null => {
  if (RSID_NAME.test(name)) return { kind: "rsid", name, rsid: name };
  const site = SITE_NAME.exec(name);
  if (site === null) return null;
  const pos = Number(site[2]);
  if (pos > MAX_POSITION) return null;
  return { kind: "site", name, chrom: canonicalChrom(site[1] ?? ""), pos };
};

/** The ways a file may write a chromosome, for the stored-row query. */
export const chromSpellings = (chrom: string): readonly string[] =>
  chrom === "M" ? ["chrM", "chrMT", "M", "MT"] : [`chr${chrom}`, chrom];

export type VariantRecord = Readonly<{
  chrom: string;
  pos: number;
  /** The ID column as written: one rsID, several joined by `;`, or null. */
  variantId: string | null;
  ref: string;
  alt: string;
  genotype: string | null;
  filter: string | null;
}>;

/** The IDs of the VCF ID column (`rs1;rs2`). */
export const recordIds = (variantId: string | null): readonly string[] =>
  variantId === null ? [] : variantId.split(";").filter((id) => id !== "");

/** True when the stored record is the one the name asks for. */
export const recordMatches = (name: VariantName, record: VariantRecord): boolean =>
  name.kind === "rsid"
    ? recordIds(record.variantId).includes(name.rsid)
    : canonicalChrom(record.chrom) === name.chrom && record.pos === name.pos;

/**
 * GT spelt out in bases: `0/1` with REF `C` and ALT `T` is `C/T`; phasing is
 * kept. Null for a no-call or an index the record does not list, so a
 * genotype is never guessed.
 */
export const genotypeBases = (
  record: Pick<VariantRecord, "ref" | "alt" | "genotype">,
): string | null => {
  if (record.genotype === null) return null;
  const alleles = [record.ref, ...record.alt.split(",")];
  const indexes = record.genotype.split(/[/|]/);
  const separators = record.genotype.match(/[/|]/g) ?? [];
  const bases = indexes.map((index) =>
    /^\d+$/.test(index) ? alleles[Number(index)] : undefined,
  );
  if (bases.some((base) => base === undefined)) return null;
  return bases
    .map((base, at) => (at === 0 ? base : `${separators[at - 1] ?? "/"}${base}`))
    .join("");
};

export type ParsedNames = Readonly<{
  names: readonly VariantName[];
  malformed: readonly string[];
}>;

/** Each distinct name once, in the order given, and the ones that cannot be read. */
export const parseVariantNames = (raw: readonly string[]): ParsedNames => {
  const distinct = [...new Set(raw)];
  const parsed = distinct.map((name) => ({ name, parsed: parseVariantName(name) }));
  return {
    names: parsed.flatMap((each) => (each.parsed === null ? [] : [each.parsed])),
    malformed: parsed.flatMap((each) => (each.parsed === null ? [each.name] : [])),
  };
};
