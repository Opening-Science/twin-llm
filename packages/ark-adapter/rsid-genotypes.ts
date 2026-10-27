/**
 * The rsid-genotypes Ark app as TwinLLM sees it: its closed panel, the grants
 * `appRun` records, and a strict parser for the report the owner releases.
 *
 * The panel mirrors `apps/ark/rsid-genotypes/src/lib.rs` (same order, same
 * rsIDs). Gene, star allele and the one-line gene note are public CPIC /
 * PharmGKB context for display and for the Carbon-X prompt; the app itself
 * prints none of them. Pure: the browser and the server share it.
 *
 * The parser refuses anything that is not exactly the app's output: a title,
 * eleven rows in panel order, the footer. A missing genotype is `no call`,
 * never a homozygous-reference fill.
 */

export const RSID_GENOTYPES_APP = "rsid-genotypes" as const;
export const RSID_GENOTYPES_TITLE = "# rsID genotypes";
export const RSID_GENOTYPES_FOOTER =
  "Research use only; genotypes as recorded in the loaded call file.";
export const RSID_NO_CALL = "no call";
/** App 0.2.0: the site's optional grant was not mounted (declined, or no data). */
export const RSID_NOT_GRANTED = "not granted";
export const RSID_GENOTYPES_VERSION = "0.2.0";
/** Public grant the manifest requires, so an Ark without small variants refuses. */
export const RSID_GENOTYPES_REQUIRED = "v1/genome/datasets/small-variants";

export type RsidPanelEntry = Readonly<{
  rsid: string;
  gene: string;
  /** The star allele (or HGVS name) this site defines, from CPIC / PharmGKB tables. */
  allele: string;
  /** What the gene's product is, in plain words. Context only, never advice. */
  geneNote: string;
}>;

const CYP_NOTE = "a liver cytochrome P450 enzyme that breaks down many medicines";

export const RSID_PANEL: readonly RsidPanelEntry[] = [
  { rsid: "rs4244285", gene: "CYP2C19", allele: "*2", geneNote: CYP_NOTE },
  { rsid: "rs4986893", gene: "CYP2C19", allele: "*3", geneNote: CYP_NOTE },
  { rsid: "rs12248560", gene: "CYP2C19", allele: "*17", geneNote: CYP_NOTE },
  { rsid: "rs1799853", gene: "CYP2C9", allele: "*2", geneNote: CYP_NOTE },
  { rsid: "rs1057910", gene: "CYP2C9", allele: "*3", geneNote: CYP_NOTE },
  { rsid: "rs3892097", gene: "CYP2D6", allele: "*4", geneNote: CYP_NOTE },
  { rsid: "rs1065852", gene: "CYP2D6", allele: "*10", geneNote: CYP_NOTE },
  {
    rsid: "rs4149056",
    gene: "SLCO1B1",
    allele: "*5",
    geneNote: "OATP1B1, a transporter that takes compounds up into liver cells",
  },
  {
    rsid: "rs3918290",
    gene: "DPYD",
    allele: "*2A",
    geneNote: "dihydropyrimidine dehydrogenase, which breaks down pyrimidines",
  },
  {
    rsid: "rs1142345",
    gene: "TPMT",
    allele: "*3C",
    geneNote: "thiopurine S-methyltransferase, which methylates thiopurine compounds",
  },
  {
    rsid: "rs9923231",
    gene: "VKORC1",
    allele: "c.-1639G>A",
    geneNote: "vitamin K epoxide reductase, part of the vitamin K cycle",
  },
];

/**
 * The panel's optional grants, in the manifest's order; `appRun` records them
 * for the audit. The owner switches each one on at approval.
 */
export const RSID_GENOTYPES_GRANTS: readonly string[] = RSID_PANEL.map(
  (entry) => `v1/genome/rsids/${entry.rsid}`,
);

export const panelEntry = (rsid: string): RsidPanelEntry | undefined =>
  RSID_PANEL.find((entry) => entry.rsid === rsid);

/** One report line. Empty leaves stay null; a missing genotype is null (`no call`). */
export type RsidGenotypeRow = Readonly<{
  rsid: string;
  chromosome: string | null;
  /** 1-based, as the call file records it. */
  position: number | null;
  reference: string | null;
  genotype: string | null;
  /** False when the site was not mounted (declined or no data); absent means granted. */
  granted?: boolean;
}>;

export type RsidReportParse =
  | Readonly<{ ok: true; rows: readonly RsidGenotypeRow[] }>
  | Readonly<{ ok: false; issue: string }>;

const CHROMOSOME = /^chr([1-9]|1\d|2[0-2]|X|Y|M)$/;
const POSITION = /^[1-9]\d{0,9}$/;
const ALLELE = /^[ACGTN]+$/;
/**
 * ArkOS 0.13 genotype shapes (dark-bio/examples docs/03-data-paths.md): one
 * allele per copy joined by `/` or `|`, an optional leading phase marker, `.`
 * for a missing allele, `*` for a copy a deletion removed, and symbolic
 * alleles such as `<DEL>`. Breakends are refused as unreadable.
 */
const GENOTYPE_ALLELE = String.raw`(?:[ACGTN]+|\.|\*|<[A-Z0-9:._]+>)`;
const GENOTYPE = new RegExp(
  String.raw`^[/|]?${GENOTYPE_ALLELE}(?:[/|]${GENOTYPE_ALLELE})*$`,
);

type FieldResult<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false }>;

const optional = <T>(
  raw: string,
  valid: (value: string) => boolean,
  read: (value: string) => T,
): FieldResult<T | null> =>
  raw === ""
    ? { ok: true, value: null }
    : valid(raw)
      ? { ok: true, value: read(raw) }
      : { ok: false };

const parseRow = (
  line: string,
  expected: RsidPanelEntry,
  index: number,
): RsidGenotypeRow | string => {
  const fields = line.split("\t");
  if (fields.length !== 5) return `row ${index + 1} does not have five fields`;
  const [rsid = "", chromosomeRaw = "", positionRaw = "", referenceRaw = "", call = ""] =
    fields.map((field) => field.trim());
  if (rsid !== expected.rsid) {
    return `row ${index + 1} is ${rsid || "empty"}, expected ${expected.rsid}`;
  }
  if (call === RSID_NOT_GRANTED) {
    if (chromosomeRaw !== "" || positionRaw !== "" || referenceRaw !== "") {
      return `${rsid} is not granted but has leaves`;
    }
    return {
      rsid,
      chromosome: null,
      position: null,
      reference: null,
      genotype: null,
      granted: false,
    };
  }
  const chromosome = optional(chromosomeRaw, (v) => CHROMOSOME.test(v), String);
  const position = optional(positionRaw, (v) => POSITION.test(v), Number);
  const reference = optional(referenceRaw.toUpperCase(), (v) => ALLELE.test(v), String);
  const genotype =
    call === RSID_NO_CALL
      ? ({ ok: true, value: null } as const)
      : GENOTYPE.test(call.toUpperCase())
        ? ({ ok: true, value: call.toUpperCase() } as const)
        : ({ ok: false } as const);
  if (!chromosome.ok) return `${rsid} has an unreadable chromosome`;
  if (!position.ok) return `${rsid} has an unreadable position`;
  if (!reference.ok) return `${rsid} has an unreadable reference allele`;
  if (!genotype.ok) return `${rsid} has an unreadable genotype`;
  return {
    rsid,
    chromosome: chromosome.value,
    position: position.value,
    reference: reference.value,
    genotype: genotype.value,
  };
};

/** The app's exact output, or the first thing that is not. */
export const parseRsidGenotypesReport = (text: string): RsidReportParse => {
  const lines = text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  const expectedLength = RSID_PANEL.length + 4;
  if (lines[0] !== RSID_GENOTYPES_TITLE) return { ok: false, issue: "missing title" };
  if (lines.length !== expectedLength) {
    return { ok: false, issue: `expected ${expectedLength} lines, got ${lines.length}` };
  }
  if (lines[1] !== "" || lines[expectedLength - 2] !== "") {
    return { ok: false, issue: "blank lines around the table are missing" };
  }
  if (lines[expectedLength - 1] !== RSID_GENOTYPES_FOOTER) {
    return { ok: false, issue: "missing research-use footer" };
  }
  const parsed = RSID_PANEL.map((entry, index) =>
    parseRow(lines[index + 2] ?? "", entry, index),
  );
  const firstIssue = parsed.find((row): row is string => typeof row === "string");
  if (firstIssue !== undefined) return { ok: false, issue: firstIssue };
  return {
    ok: true,
    rows: parsed.filter((row): row is RsidGenotypeRow => typeof row !== "string"),
  };
};

/**
 * The base alleles of a genotype (`A/G` → [A, G], `|A|G` → [A, G]); empty for
 * `no call`. A missing (`.`), deleted (`*`) or symbolic (`<DEL>`) copy has no
 * bases, so it is left out rather than read as the reference.
 */
export const genotypeAlleles = (genotype: string | null): readonly string[] =>
  genotype === null ? [] : genotype.split(/[/|]/).filter((allele) => ALLELE.test(allele));
