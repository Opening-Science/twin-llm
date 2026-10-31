import "server-only";

import { type JSONValue, tool, type ToolSet } from "ai";
import type { z } from "zod";

import type { StoredGenomeReport } from "@/infrastructure/genome-report-store";
import type { AppendInput } from "@/packages/audit/append";
import {
  genotypeAlleles,
  panelEntry,
  RSID_GENOTYPES_FOOTER,
} from "@/packages/ark-adapter/rsid-genotypes";
import { withholdAdvice } from "@/packages/carbon-x/answer-filter";
import type { CarbonXAnswer } from "@/packages/carbon-x/client";
import {
  CARBON_X_LABEL,
  CARBON_X_RESEARCH_NOTE,
  DNA_ASK_AUDIT_TOOL,
  DNA_ASK_TOOL,
  GENOME_REPORT_AUDIT_TOOL,
  GENOME_REPORT_TOOL,
} from "@/packages/carbon-x/constants";
import { buildCarbonXMessages, type CarbonXMessage } from "@/packages/carbon-x/prompt";
import {
  dnaAskInput,
  GENOME_TOOL_DEFINITIONS,
  genomeReportInput,
} from "@/packages/carbon-x/schema";
import { decideBuild } from "@/packages/genome-reference/build";
import type {
  ReferenceWindows,
  WindowRequest,
} from "@/packages/genome-reference/windows";
import { GENOME_VARIANTS_TOOL } from "@/packages/query-tools/imported-names";
import {
  type GenomeVariantsDeps,
  runGenomeVariants,
} from "@/packages/query-tools/imported-variants";
import {
  GENOME_VARIANTS_TOOL_DEFINITION,
  genomeVariantsInput,
} from "@/packages/query-tools/imported-variants-schema";
import { modelInputSchema } from "@/packages/query-tools/model-schema";
import type { SessionScope } from "@/packages/query-tools/scope";

/**
 * `genome_report` and `dna_ask`: the chat's only way to the Ark report, and
 * `genome_variants` (#307, `packages/query-tools/imported-variants.ts`) to an
 * imported VCF.
 *
 * The first two exist on a turn only when `genomeChatPermit()` holds (personal
 * mode, GENOME_SOURCE=ark, a local chat model, a local Carbon-X), and they
 * refuse again here if the scope is not personal. `genome_variants` has its
 * own, smaller permit (`vcfVariantsChatPermit()`, #330: personal mode and a
 * local chat model) and its own deps (`createGenomeVariantTools`). The model gives an rsID and
 * nothing else; the server reads the stored report, builds the windows from
 * the public GRCh38 reference, and asks Carbon-X. Every call writes one audit
 * row with the rsID, the report id and the outcome, never a genotype, an
 * answer, or a hash of either: a genotype has so few possible values that a
 * plain hash of it could be reversed.
 */

export type GenomeToolDeps = Readonly<{
  scope: SessionScope;
  loadReport: () => Promise<StoredGenomeReport | null>;
  assumeBuild: "GRCh38" | null;
  windows: (
    request: Omit<WindowRequest, "flank"> & Readonly<{ flank?: number }>,
  ) => Promise<ReferenceWindows | Readonly<{ code: string; error: string }>>;
  ask: (messages: readonly CarbonXMessage[]) => Promise<CarbonXAnswer>;
  appendAudit: (input: AppendInput) => Promise<unknown>;
  /** Bases each side of the site; the reference package defaults to 256. */
  flank?: number;
}>;

export type GenomeRefusal = Readonly<{ code: string; error: string }>;

const refusal = (code: string, error: string): GenomeRefusal => ({ code, error });

const NOT_PERSONAL = refusal(
  "GENOME_NOT_PERMITTED",
  "genome tools run only in personal data mode on this machine",
);
const NO_REPORT = refusal(
  "NO_REPORT",
  "no genome report has been released yet; run rsid-genotypes on the Digital Twin page first",
);

const CARBON_X_ERRORS: Readonly<Record<string, string>> = {
  CARBON_X_NOT_LOCAL: "Carbon-X is not on this machine, so nothing was sent",
  CARBON_X_UNREACHABLE: "the local Carbon-X sidecar is not running",
  CARBON_X_TIMEOUT: "the local Carbon-X sidecar did not answer in time",
  CARBON_X_FAILED: "the local Carbon-X sidecar did not return an answer",
};

export type GenomeReportOutput =
  | Readonly<{
      source: string;
      released_at: string;
      build: string | null;
      rows: readonly Readonly<{
        rsid: string;
        gene: string;
        allele: string;
        gene_note: string;
        chromosome: string | null;
        position: number | null;
        reference: string | null;
        genotype: string;
      }>[];
      note: string;
    }>
  | GenomeRefusal;

export type DnaAskOutput =
  | Readonly<{
      source: typeof CARBON_X_LABEL;
      rsid: string;
      gene: string;
      allele: string;
      site: string;
      genotype: string;
      answer: string;
      withheld_sentences: number;
      note: string;
    }>
  | GenomeRefusal;

const audit = (
  deps: GenomeToolDeps,
  tool: string,
  args: Record<string, JSONValue>,
  result: Record<string, JSONValue>,
  rowCount: number,
) =>
  deps.appendAudit({
    actor: deps.scope.actor,
    sessionId: deps.scope.sessionId,
    subjectRef: null,
    tool,
    args,
    result,
    rowCount,
  });

export const runGenomeReport = async (
  deps: GenomeToolDeps,
): Promise<GenomeReportOutput> => {
  if (deps.scope.mode !== "personal") return NOT_PERSONAL;
  const report = await deps.loadReport();
  if (report === null) {
    await audit(deps, GENOME_REPORT_AUDIT_TOOL, {}, { code: NO_REPORT.code }, 0);
    return NO_REPORT;
  }
  await audit(
    deps,
    GENOME_REPORT_AUDIT_TOOL,
    {},
    { report_id: report.id, rows: report.rows.length },
    report.rows.length,
  );
  return {
    source: "Ark rsid-genotypes report, released by the owner",
    released_at: report.releasedAt,
    build: report.arkBuild,
    rows: report.rows.map((row) => {
      const entry = panelEntry(row.rsid);
      return {
        rsid: row.rsid,
        gene: entry?.gene ?? "",
        allele: entry?.allele ?? "",
        gene_note: entry?.geneNote ?? "",
        chromosome: row.chromosome,
        position: row.position,
        reference: row.reference,
        genotype: row.genotype ?? "no call",
      };
    }),
    note: RSID_GENOTYPES_FOOTER,
  };
};

type DnaAskInput = z.infer<typeof dnaAskInput>;

/** Everything before Carbon-X: the row, its build and its windows, or a refusal. */
const prepare = async (
  deps: GenomeToolDeps,
  input: DnaAskInput,
  report: StoredGenomeReport,
) => {
  const row = report.rows.find((entry) => entry.rsid === input.rsid);
  const entry = panelEntry(input.rsid);
  if (row === undefined || entry === undefined) {
    return refusal("RSID_NOT_IN_REPORT", `${input.rsid} is not in the released report`);
  }
  if (row.genotype === null) {
    return refusal(
      "NO_CALL",
      `the report has no call at ${input.rsid}, so nothing was asked`,
    );
  }
  if (row.chromosome === null || row.position === null || row.reference === null) {
    return refusal("INCOMPLETE_ROW", `the report has no position for ${input.rsid}`);
  }
  const build = decideBuild({ arkBuild: report.arkBuild, assumeBuild: deps.assumeBuild });
  if (!build.ok) return refusal(build.code, build.error);
  const windows = await deps.windows({
    chromosome: row.chromosome,
    position: row.position,
    reference: row.reference,
    alternates: genotypeAlleles(row.genotype),
    flank: deps.flank,
  });
  if ("code" in windows) return refusal(windows.code, windows.error);
  return { row: { ...row, genotype: row.genotype }, entry, windows };
};

export const runDnaAsk = async (
  deps: GenomeToolDeps,
  input: DnaAskInput,
): Promise<DnaAskOutput> => {
  if (deps.scope.mode !== "personal") return NOT_PERSONAL;
  const report = await deps.loadReport();
  const args = { rsid: input.rsid, report_id: report?.id ?? null };
  const refuse = async (found: GenomeRefusal): Promise<GenomeRefusal> => {
    await audit(deps, DNA_ASK_AUDIT_TOOL, args, { code: found.code }, 0);
    return found;
  };
  if (report === null) return refuse(NO_REPORT);

  const prepared = await prepare(deps, input, report);
  if ("code" in prepared) return refuse(prepared);
  const { row, entry, windows } = prepared;

  const messages = buildCarbonXMessages(
    {
      rsid: row.rsid,
      gene: entry.gene,
      allele: entry.allele,
      geneNote: entry.geneNote,
      chromosome: windows.chromosome,
      position: windows.position,
      build: "GRCh38",
      reference: windows.reference.allele,
      genotype: row.genotype,
      windowStart: windows.windowStart,
      flank: windows.flank,
      referenceWindow: windows.reference.sequence,
      alternates: windows.alternates,
    },
    input.question,
  );
  const answer = await deps.ask(messages);
  if (!answer.ok) {
    return refuse(
      refusal(answer.code, CARBON_X_ERRORS[answer.code] ?? "Carbon-X failed"),
    );
  }
  const filtered = withholdAdvice(answer.text);
  await audit(
    deps,
    DNA_ASK_AUDIT_TOOL,
    { ...args, flank: windows.flank, build: "GRCh38" },
    { answered: true, answer_chars: filtered.text.length, withheld: filtered.withheld },
    1,
  );
  return {
    source: CARBON_X_LABEL,
    rsid: row.rsid,
    gene: entry.gene,
    allele: entry.allele,
    site: `${windows.chromosome}:${windows.position} (GRCh38)`,
    genotype: row.genotype,
    answer: filtered.text,
    withheld_sentences: filtered.withheld,
    note: CARBON_X_RESEARCH_NOTE,
  };
};

const [REPORT_DEFINITION, DNA_ASK_DEFINITION] = GENOME_TOOL_DEFINITIONS;

/**
 * `genome_variants` (#307) over the person's imported VCF. The chat route
 * builds its deps only when `vcfVariantsChatPermit()` holds (#330), and the
 * tool asks that permit again on every call.
 */
export const createGenomeVariantTools = (deps: GenomeVariantsDeps): ToolSet => ({
  [GENOME_VARIANTS_TOOL]: tool({
    description: GENOME_VARIANTS_TOOL_DEFINITION.description,
    inputSchema: modelInputSchema(genomeVariantsInput),
    execute: async (input) => runGenomeVariants(deps, input),
  }),
});

export const createGenomeTools = (deps: GenomeToolDeps) => ({
  [GENOME_REPORT_TOOL]: tool({
    description: REPORT_DEFINITION.description,
    inputSchema: modelInputSchema(genomeReportInput),
    execute: async (): Promise<GenomeReportOutput> => runGenomeReport(deps),
  }),
  [DNA_ASK_TOOL]: tool({
    description: DNA_ASK_DEFINITION.description,
    inputSchema: modelInputSchema(dnaAskInput),
    execute: async (input): Promise<DnaAskOutput> => runDnaAsk(deps, input),
  }),
});
