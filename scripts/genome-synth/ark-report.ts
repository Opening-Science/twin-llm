/**
 * The rsid-genotypes report as the Ark app prints it
 * (`apps/ark/rsid-genotypes/src/lib.rs`): a title, a blank line, one TSV line
 * per panel site in panel order, a blank line and the research-use footer.
 * Pure. `ark-report.test.ts` checks the panel order against the Rust source
 * and the output against the app's goldens, so the two cannot drift.
 */
import type { Variant } from "./catalog";
import { alleles, type Call } from "./genotypes";

export const ARK_APP = "rsid-genotypes";
export const ARK_APP_VERSION = "0.1.0";
export const TITLE = "# rsID genotypes";
export const FOOTER = "Research use only; genotypes as recorded in the loaded call file.";
export const NO_CALL = "no call";

/** The app's closed panel, in report order. */
export const ARK_PANEL = [
  "rs4244285",
  "rs4986893",
  "rs12248560",
  "rs1799853",
  "rs1057910",
  "rs3892097",
  "rs1065852",
  "rs4149056",
  "rs3918290",
  "rs1142345",
  "rs9923231",
] as const;

export type ReportRow = Readonly<{
  rsid: string;
  chromosome: string;
  position: string;
  reference: string;
  /** null prints `no call`. */
  genotype: string | null;
}>;

export const formatLine = (row: ReportRow): string =>
  [row.rsid, row.chromosome, row.position, row.reference, row.genotype ?? NO_CALL].join(
    "\t",
  );

export const renderReport = (rows: readonly ReportRow[]): string =>
  `${[TITLE, "", ...rows.map(formatLine), "", FOOTER].join("\n")}\n`;

const rowOf = (variant: Variant, call: Call | undefined): ReportRow => ({
  rsid: variant.rsid,
  chromosome: variant.chrom,
  position: String(variant.pos),
  reference: variant.ref,
  genotype: call === undefined ? null : alleles(call),
});

/**
 * The report the Ark app would print for these calls. Every panel site must be
 * in the catalog; a site without a call prints `no call`, as the app does.
 */
export const reportFor = (calls: readonly Call[], catalog: readonly Variant[]): string =>
  renderReport(
    ARK_PANEL.map((rsid) => {
      const variant = catalog.find((entry) => entry.rsid === rsid);
      if (variant === undefined)
        throw new Error(`panel site ${rsid} is not in the catalog`);
      return rowOf(
        variant,
        calls.find((call) => call.variant.rsid === rsid),
      );
    }),
  );
