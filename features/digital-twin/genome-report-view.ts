import {
  panelEntry,
  RSID_GENOTYPES_FOOTER,
  type RsidGenotypeRow,
} from "@/packages/ark-adapter/rsid-genotypes";
import { decideBuild } from "@/packages/genome-reference/build";

/**
 * What the genome dashboard shows of a released report, and the fixed
 * sentences for every way a run can end. Pure: the routes build it and the
 * browser checks it. No Ark or provider text ever reaches a person.
 */

export type GenomeReportRowView = Readonly<{
  rsid: string;
  gene: string;
  allele: string;
  chromosome: string | null;
  position: number | null;
  reference: string | null;
  /** Null is `no call`, never a reference fill. */
  genotype: string | null;
}>;

export type GenomeReportView = Readonly<{
  id: string;
  releasedAt: string;
  buildNote: string;
  footer: string;
  rows: readonly GenomeReportRowView[];
}>;

export type GenomeReportPayload =
  | Readonly<{ enabled: false }>
  | Readonly<{ enabled: true; report: GenomeReportView | null }>;

export type GenomeRunFailure = Readonly<{
  ok: false;
  code: string;
  message: string;
}>;

export type GenomeRunPayload =
  Readonly<{ ok: true; report: GenomeReportView }> | GenomeRunFailure;

export const buildNote = (
  arkBuild: string | null,
  assumeBuild: "GRCh38" | null,
): string => {
  const decision = decideBuild({ arkBuild, assumeBuild });
  if (decision.ok) {
    return decision.source === "ark"
      ? "Build GRCh38, as the Ark names it"
      : "Build GRCh38, as GENOME_ASSUME_BUILD states; the Ark named none";
  }
  return decision.code === "BUILD_MISMATCH"
    ? `Build ${arkBuild ?? ""}: Carbon-X windows are GRCh38 only, so they are refused`
    : "The Ark named no build, so Carbon-X windows are refused";
};

export const toReportView = (
  report: Readonly<{
    id: string;
    releasedAt: string;
    arkBuild: string | null;
    rows: readonly RsidGenotypeRow[];
  }>,
  assumeBuild: "GRCh38" | null,
): GenomeReportView => ({
  id: report.id,
  releasedAt: report.releasedAt,
  buildNote: buildNote(report.arkBuild, assumeBuild),
  footer: RSID_GENOTYPES_FOOTER,
  rows: report.rows.map((row) => {
    const entry = panelEntry(row.rsid);
    return {
      rsid: row.rsid,
      gene: entry?.gene ?? "",
      allele: entry?.allele ?? "",
      chromosome: row.chromosome,
      position: row.position,
      reference: row.reference,
      genotype: row.genotype,
    };
  }),
});

/** One sentence per way a run ends without a report. */
export const RUN_FAILURE_TEXT: Readonly<Record<string, string>> = {
  refused: "The run was declined on your phone. Nothing was released.",
  awaiting_approval: "Nobody answered on your phone in time. Nothing was released.",
  busy: "The Ark is busy. Close the Ark Hub tab and run again.",
  locked: "The Ark is locked. Unlock it in the Companion app and run again.",
  unpaired: "This computer is not paired with the Ark.",
  error: "The Ark run did not finish. Run again.",
  "app-not-built": "The rsid-genotypes app is not built. Run bun run ark:build first.",
  "report-unreadable":
    "The Ark released something that is not the rsid-genotypes report, so nothing was stored.",
  "not-permitted":
    "Genome runs need DATA_MODE=personal and GENOME_SOURCE=ark on this server.",
  "sign-in": "Sign in to run the Ark app.",
};

export const runFailure = (code: string): GenomeRunFailure => ({
  ok: false,
  code,
  message: RUN_FAILURE_TEXT[code] ?? RUN_FAILURE_TEXT.error ?? "",
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isRowView = (value: unknown): value is GenomeReportRowView =>
  isRecord(value) &&
  typeof value.rsid === "string" &&
  typeof value.gene === "string" &&
  typeof value.allele === "string" &&
  (value.genotype === null || typeof value.genotype === "string");

export const isReportView = (value: unknown): value is GenomeReportView =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.releasedAt === "string" &&
  typeof value.buildNote === "string" &&
  typeof value.footer === "string" &&
  Array.isArray(value.rows) &&
  value.rows.every(isRowView);

export const isReportPayload = (value: unknown): value is GenomeReportPayload =>
  isRecord(value) &&
  (value.enabled === false ||
    (value.enabled === true && (value.report === null || isReportView(value.report))));

export const isRunPayload = (value: unknown): value is GenomeRunPayload =>
  isRecord(value) &&
  ((value.ok === true && isReportView(value.report)) ||
    (value.ok === false &&
      typeof value.code === "string" &&
      typeof value.message === "string"));
