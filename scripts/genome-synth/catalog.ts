/**
 * The curated variant table (`variants.tsv`): rsID, GRCh38 position, reference
 * and alternate allele, one population allele frequency, gene, consequence and
 * ClinVar significance. Public summary data only; sources and licences are in
 * the file's header and in docs/genome-synthetic.md. Pure: the reading of the
 * file is the caller's.
 */
export const CATALOG_COLUMNS = [
  "rsid",
  "category",
  "gene",
  "chrom",
  "pos",
  "ref",
  "alt",
  "alt_af",
  "af_source",
  "consequence",
  "clinvar",
  "note",
] as const;

export const CATEGORIES = [
  "panel",
  "pgx",
  "clinvar_pathogenic",
  "clinvar_benign",
  "trait",
] as const;

export type Category = (typeof CATEGORIES)[number];

export type Variant = Readonly<{
  rsid: string;
  category: Category;
  gene: string;
  /** GRCh38 contig name with the `chr` prefix, as the Ark report prints it. */
  chrom: string;
  /** 1-based GRCh38 position. */
  pos: number;
  ref: string;
  alt: string;
  /** Frequency of `alt` in the population named by `afSource`. */
  altAf: number;
  afSource: string;
  /** Sequence Ontology term, as Ensembl names the most severe consequence. */
  consequence: string;
  /** ClinVar significances as Ensembl imports them, sorted, `;`-separated; may be empty. */
  clinvar: string;
  note: string;
}>;

const isCategory = (value: string): value is Category =>
  (CATEGORIES as readonly string[]).includes(value);

const BASE = /^[ACGT]$/;
const RSID = /^rs\d+$/;
const CHROM = /^chr(?:[1-9]|1\d|2[0-2])$/;

/** The variants of a catalog file, or a plain message naming the first bad line. */
export const parseCatalog = (text: string): readonly Variant[] | string => {
  const lines = text
    .split("\n")
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  const [header, ...body] = lines;
  if (header !== CATALOG_COLUMNS.join("\t")) return "variants.tsv: unexpected header";
  const variants: Variant[] = [];
  for (const [index, line] of body.entries()) {
    const cells = line.split("\t");
    const where = `variants.tsv data line ${index + 1}`;
    if (cells.length !== CATALOG_COLUMNS.length) return `${where}: wrong column count`;
    const [rsid, category, gene, chrom, pos, ref, alt, altAf, afSource, consequence] =
      cells as [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ];
    const clinvar = cells[10] ?? "";
    const note = cells[11] ?? "";
    const position = Number(pos);
    const frequency = Number(altAf);
    if (!RSID.test(rsid)) return `${where}: bad rsid`;
    if (!isCategory(category)) return `${where}: bad category`;
    if (!CHROM.test(chrom)) return `${where}: not an autosome`;
    if (!(Number.isInteger(position) && position > 0)) return `${where}: bad position`;
    if (!BASE.test(ref) || !BASE.test(alt) || ref === alt) return `${where}: bad alleles`;
    if (!(frequency > 0 && frequency < 1)) return `${where}: bad allele frequency`;
    if (gene === "" || afSource === "" || consequence === "") {
      return `${where}: empty gene, source or consequence`;
    }
    variants.push({
      rsid,
      category,
      gene,
      chrom,
      pos: position,
      ref,
      alt,
      altAf: frequency,
      afSource,
      consequence,
      clinvar,
      note,
    });
  }
  const ids = variants.map((variant) => variant.rsid);
  if (new Set(ids).size !== ids.length) return "variants.tsv: an rsid is listed twice";
  return variants;
};

/** The file text for a header block and rows, in the given order. */
export const renderCatalog = (
  header: readonly string[],
  rows: readonly Variant[],
): string =>
  [
    ...header,
    CATALOG_COLUMNS.join("\t"),
    ...rows.map((row) =>
      [
        row.rsid,
        row.category,
        row.gene,
        row.chrom,
        String(row.pos),
        row.ref,
        row.alt,
        String(row.altAf),
        row.afSource,
        row.consequence,
        row.clinvar,
        row.note,
      ].join("\t"),
    ),
    "",
  ].join("\n");

const CHROM_ORDER = (chrom: string): number => Number(chrom.slice(3));

/** Variants in VCF order: by chromosome number, then position. */
export const byPosition = (variants: readonly Variant[]): Variant[] =>
  [...variants].sort(
    (a, b) => CHROM_ORDER(a.chrom) - CHROM_ORDER(b.chrom) || a.pos - b.pos,
  );
