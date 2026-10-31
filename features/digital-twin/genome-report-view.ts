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
  /** Null is `no call` (or `not granted`), never a reference fill. */
  genotype: string | null;
  /** False when the site's optional grant was not mounted: declined or not on the Ark. */
  granted: boolean;
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
      granted: row.granted !== false,
    };
  }),
});

/** One sentence per way a run ends without a report. */
export const RUN_FAILURE_TEXT: Readonly<Record<string, string>> = {
  refused: "You declined the run or the report on your phone; nothing was stored.",
  awaiting_approval:
    "Nobody answered on your phone in time (5 minutes to approve the run, 10 to release the report); nothing was stored.",
  outdated: "Ark firmware too old: run `ark firmware update`.",
  undelivered: "The request never reached your phone. Open Ark Companion and run again.",
  rejected:
    "The Ark refused to run the app, for example because no small variants are loaded. Nothing was asked on your phone.",
  app_failed: "The app failed on the Ark; nothing was stored.",
  busy: "The Ark is busy. Close the Ark Hub tab and run again.",
  locked: "The Ark is locked. Unlock it in the Companion app and run again.",
  unpaired: "This computer is not paired with the Ark.",
  error: "The Ark run did not finish. Run again.",
  "app-not-built": "The rsid-genotypes app is not built. Run bun run ark:build first.",
  "report-unreadable":
    "The Ark released something that is not the rsid-genotypes report, so nothing was stored.",
  "not-recorded":
    "The release could not be written to the disclosure ledger, so nothing was stored. Run again.",
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
  (value.genotype === null || typeof value.genotype === "string") &&
  typeof value.granted === "boolean";

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
