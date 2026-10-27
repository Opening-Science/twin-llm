/**
 * Genome conversation families: questions about the asker's own released
 * rsid-genotypes report, read with `genome_report` and asked about with
 * `dna_ask` (the chat's genome tools, #107), plus the cases where the honest
 * answer is a refusal or "there is nothing to ask". Pure.
 *
 * The report is the synthetic subject's (`scripts/genome-synth`): exactly what
 * the Ark app would print for that subject's synthetic VCF, parsed by the
 * same parser a device report goes through. Tool results have the shapes the
 * real tools return. The real Carbon-X output is not available here, so a
 * `dna_ask` answer is a fixed text built from the curated catalog row (gene,
 * consequence, ClinVar significance), and its `source` says it is a synthetic
 * stand-in. A no-call or a site outside the report gets no `dna_ask` call,
 * since the real tool refuses both. Answers quote the labelled answer, say it
 * is research only and never give a dose, a medicine change or a clinical
 * reading.
 */
import {
  panelEntry,
  parseRsidGenotypesReport,
  RSID_GENOTYPES_FOOTER,
  RSID_NO_CALL,
  type RsidPanelEntry,
} from "../../packages/ark-adapter/rsid-genotypes";
import {
  CARBON_X_RESEARCH_NOTE,
  DNA_ASK_TOOL,
  GENOME_REPORT_TOOL,
} from "../../packages/carbon-x/constants";
import { ARK_PANEL, reportFor } from "../genome-synth/ark-report";
import type { Variant } from "../genome-synth/catalog";
import { alleles, type Call, callsFor } from "../genome-synth/genotypes";
import { pick } from "../synthetic-wearables/random";

import {
  asked,
  type Draft,
  type FamilyContext,
  sections,
  type ToolCall,
} from "./family-kit";
import { GENOME_BANK } from "./genome-questions";
import { askFrom } from "./questions";

/** `genome_report`'s source line, as `features/chat/genome-tools.ts` writes it. */
export const REPORT_SOURCE = "Ark rsid-genotypes report, released by the owner";

/** The `source` of every training `dna_ask` answer: never the Carbon-X label. */
export const STAND_IN_SOURCE =
  "Synthetic stand-in for Carbon-X (research model): training data, not model output";

export const GENOME_SYNTHETIC_NOTE =
  "The genotypes are synthetic (TwinLLM genome-synth) and describe no real person.";

/** The build a synthetic VCF names; the stored report keeps it as the Ark's. */
const BUILD = "GRCh38";

const words = (term: string) => term.replaceAll("_", " ");

const significance = (variant: Variant): string =>
  variant.clinvar === ""
    ? "no ClinVar significance listed"
    : variant.clinvar.split(";").join(", ");

/** The fixed stand-in answer for one catalog row. */
export const standInAnswer = (variant: Variant): string =>
  `${variant.rsid} lies in ${variant.gene} (GRCh38 ${variant.chrom}:${variant.pos} ${variant.ref}>${variant.alt}). Consequence: ${words(variant.consequence)}. ClinVar lists: ${significance(variant)}.`;

type Genome = Readonly<{
  calls: readonly Call[];
  panel: readonly Call[];
  report: string;
}>;

const genomeOf = (context: FamilyContext): Genome => {
  const catalog = context.genomeCatalog;
  if (catalog === undefined) throw new Error("genome families need the variant catalog");
  const calls = callsFor(context.subjectRef, catalog);
  const panel = ARK_PANEL.flatMap((rsid) =>
    calls.filter((call) => call.variant.rsid === rsid),
  );
  return { calls, panel, report: reportFor(calls, catalog) };
};

/** `genome_report`'s result for this report, in the shape `runGenomeReport` returns. */
export const genomeReportResult = (report: string, releasedAt: string) => {
  const parsed = parseRsidGenotypesReport(report);
  if (!parsed.ok) throw new Error(`synthetic report does not parse: ${parsed.issue}`);
  return {
    source: REPORT_SOURCE,
    released_at: releasedAt,
    build: BUILD,
    rows: parsed.rows.map((row) => {
      const entry = panelEntry(row.rsid);
      return {
        rsid: row.rsid,
        gene: entry?.gene ?? "",
        allele: entry?.allele ?? "",
        gene_note: entry?.geneNote ?? "",
        chromosome: row.chromosome,
        position: row.position,
        reference: row.reference,
        genotype: row.genotype ?? RSID_NO_CALL,
      };
    }),
    note: RSID_GENOTYPES_FOOTER,
  };
};

const readReport = (context: FamilyContext, genome: Genome): ToolCall => ({
  name: GENOME_REPORT_TOOL,
  args: {},
  result: genomeReportResult(genome.report, `${context.anchorDay}T09:00:00.000Z`),
});

const entryOf = (rsid: string): RsidPanelEntry => {
  const entry = panelEntry(rsid);
  if (entry === undefined) throw new Error(`${rsid} is not on the rsid-genotypes panel`);
  return entry;
};

/** `dna_ask`'s result in the shape `runDnaAsk` returns, with the stand-in answer. */
export const dnaAskResult = (call: Call) => {
  const { variant } = call;
  const entry = entryOf(variant.rsid);
  return {
    source: STAND_IN_SOURCE,
    rsid: variant.rsid,
    gene: entry.gene,
    allele: entry.allele,
    site: `${variant.chrom}:${variant.pos} (${BUILD})`,
    genotype: alleles(call) ?? RSID_NO_CALL,
    answer: standInAnswer(variant),
    withheld_sentences: 0,
    note: CARBON_X_RESEARCH_NOTE,
  };
};

const dnaAsk = (call: Call): ToolCall => ({
  name: DNA_ASK_TOOL,
  args: { rsid: call.variant.rsid },
  result: dnaAskResult(call),
});

/** "one copy of G and one of A", from the report's genotype. */
export const copiesText = (call: Call): string => {
  const { ref, alt } = call.variant;
  if (call.altCopies === 0)
    return `two copies of the reference allele ${ref} and none of ${alt}`;
  if (call.altCopies === 1)
    return `one copy of the reference allele ${ref} and one of ${alt}`;
  return `two copies of ${alt} and none of the reference allele ${ref}`;
};

const site = (call: Call): string => {
  const entry = entryOf(call.variant.rsid);
  return `${call.variant.rsid} is a ${entry.gene} site that defines the ${entry.allele} allele (${entry.gene}: ${entry.geneNote})`;
};

const quoted = (call: Call): string =>
  `The answer \`${DNA_ASK_TOOL}\` returned, labelled "${STAND_IN_SOURCE}", says: ${standInAnswer(call.variant)}`;

const RESEARCH_ONLY =
  "This is research information only: it does not say what the genotype means for any medicine, dose or condition.";

const singleSiteLimits =
  "One site does not define a star allele or a metaboliser status, and a research genotype is not a clinical test; a clinician or pharmacist can order one.";

/** The drug a person might ask about for each panel gene (public CPIC gene–drug pairs). */
const DRUGS: Readonly<Record<string, readonly [string, ...string[]]>> = {
  CYP2C19: ["clopidogrel", "citalopram"],
  CYP2C9: ["warfarin", "celecoxib"],
  CYP2D6: ["codeine", "tamoxifen"],
  SLCO1B1: ["simvastatin"],
  DPYD: ["fluorouracil", "capecitabine"],
  TPMT: ["azathioprine", "mercaptopurine"],
  VKORC1: ["warfarin"],
};

const WHO = ["sister", "brother", "partner", "father", "colleague", "neighbour"] as const;
const PROVIDERS = [
  "ChatGPT",
  "a hosted model",
  "OpenRouter",
  "a cloud AI",
  "Gemini",
] as const;

const nonEmpty = <T>(items: readonly T[]): readonly [T, ...T[]] | null =>
  items.length > 0 ? (items as readonly [T, ...T[]]) : null;

const called = (genome: Genome) =>
  nonEmpty(genome.panel.filter((call) => call.altCopies !== null));

export const genomeVariant = (context: FamilyContext): Draft | null => {
  const genome = genomeOf(context);
  const pool = called(genome);
  if (pool === null) return null;
  const call = pick(context.random, pool);
  const genotype = alleles(call) ?? "";
  const { rsid } = call.variant;
  return {
    family: "genome_variant",
    ...asked(askFrom(GENOME_BANK, context.random, "genomeVariant", { rsid, genotype })),
    measureLoinc: null,
    subjectRef: context.subjectRef,
    calls: [readReport(context, genome), dnaAsk(call)],
    outcome: "answered",
    reply: sections(
      `I called \`${GENOME_REPORT_TOOL}\`; the released report records ${genotype} at ${rsid}. I then called \`${DNA_ASK_TOOL}\` for ${rsid}; its answer is labelled as a synthetic stand-in for the research model.`,
      `Your report records ${genotype} at ${rsid}: ${copiesText(call)}. ${site(call)}. ${quoted(call)} ${RESEARCH_ONLY}`,
      `${singleSiteLimits} ${GENOME_SYNTHETIC_NOTE}`,
    ),
  };
};

export const genomeVariants = (context: FamilyContext): Draft | null => {
  const genome = genomeOf(context);
  const pool = called(genome);
  if (pool === null || pool.length < 2) return null;
  // Two different sites, kept in report order.
  const i = Math.floor(context.random() * pool.length);
  const drawn = Math.floor(context.random() * (pool.length - 1));
  const j = drawn >= i ? drawn + 1 : drawn;
  const a = pool[Math.min(i, j)];
  const b = pool[Math.max(i, j)];
  if (a === undefined || b === undefined) return null;
  const ga = alleles(a) ?? "";
  const gb = alleles(b) ?? "";
  return {
    family: "genome_variants",
    ...asked(
      askFrom(GENOME_BANK, context.random, "genomeVariants", {
        a: a.variant.rsid,
        ga,
        b: b.variant.rsid,
        gb,
      }),
    ),
    measureLoinc: null,
    subjectRef: context.subjectRef,
    calls: [readReport(context, genome), dnaAsk(a), dnaAsk(b)],
    outcome: "answered",
    reply: sections(
      `I called \`${GENOME_REPORT_TOOL}\`; the released report records ${ga} at ${a.variant.rsid} and ${gb} at ${b.variant.rsid}. I called \`${DNA_ASK_TOOL}\` once for each; both answers are labelled as a synthetic stand-in for the research model.`,
      `Your report records ${ga} at ${a.variant.rsid} (${copiesText(a)}) and ${gb} at ${b.variant.rsid} (${copiesText(b)}). ${site(a)}. ${quoted(a)} ${site(b)}. ${quoted(b)} ${RESEARCH_ONLY}`,
      `Each site is read on its own; together they still do not define a star allele or a metaboliser status, and a research genotype is not a clinical test. ${GENOME_SYNTHETIC_NOTE}`,
    ),
  };
};

export const genomeNoCall = (context: FamilyContext): Draft | null => {
  const genome = genomeOf(context);
  const pool = nonEmpty(genome.panel.filter((call) => call.altCopies === null));
  if (pool === null) return null;
  const call = pick(context.random, pool);
  const { rsid } = call.variant;
  const entry = entryOf(rsid);
  return {
    family: "genome_no_call",
    ...asked(askFrom(GENOME_BANK, context.random, "genomeNoCall", { rsid })),
    measureLoinc: null,
    subjectRef: context.subjectRef,
    calls: [readReport(context, genome)],
    outcome: "no_call",
    reply: sections(
      `I called \`${GENOME_REPORT_TOOL}\`; the released report says no call at ${rsid}: the call file had no genotype for that site. \`${DNA_ASK_TOOL}\` asks only about a recorded genotype, so I did not call it.`,
      `There is no genotype for you at ${rsid}, so I cannot say which alleles you carry. A no call is not the reference genotype, and I will not fill it in. ${rsid} is the ${entry.gene} site that defines the ${entry.allele} allele.`,
      `A no call can come from low coverage or a site that failed in the call file; only a new test can fill it. ${GENOME_SYNTHETIC_NOTE}`,
    ),
  };
};

export const genomeNotInReport = (context: FamilyContext): Draft | null => {
  const genome = genomeOf(context);
  const pool = nonEmpty(
    genome.calls.filter(
      (call) => !(ARK_PANEL as readonly string[]).includes(call.variant.rsid),
    ),
  );
  if (pool === null) return null;
  const { variant } = pick(context.random, pool);
  return {
    family: "genome_not_in_report",
    ...asked(
      askFrom(GENOME_BANK, context.random, "genomeNotInReport", {
        rsid: variant.rsid,
        gene: variant.gene,
      }),
    ),
    measureLoinc: null,
    subjectRef: context.subjectRef,
    calls: [readReport(context, genome)],
    outcome: "not_in_report",
    reply: sections(
      `I called \`${GENOME_REPORT_TOOL}\`; the released report lists ${ARK_PANEL.length} rsIDs, and ${variant.rsid} is not one of them. \`${DNA_ASK_TOOL}\` asks only about sites in the report, so I did not call it.`,
      `Your report has no genotype for ${variant.rsid}, so I cannot say whether you carry it, and I will not guess.`,
      `The Ark app reads a fixed panel of ${ARK_PANEL.length} sites; a site outside it stays unknown here even if the call file on the device holds it. ${GENOME_SYNTHETIC_NOTE}`,
    ),
  };
};

export const genomeDeclineDose = (context: FamilyContext): Draft | null => {
  const genome = genomeOf(context);
  const pool = called(genome);
  if (pool === null) return null;
  const call = pick(context.random, pool);
  const drugs = DRUGS[call.variant.gene];
  if (drugs === undefined) return null;
  const drug = pick(context.random, drugs);
  return {
    family: "genome_decline_dose",
    ...asked(
      askFrom(GENOME_BANK, context.random, "genomeDose", {
        rsid: call.variant.rsid,
        genotype: alleles(call) ?? "",
        gene: call.variant.gene,
        drug,
      }),
    ),
    measureLoinc: null,
    subjectRef: context.subjectRef,
    calls: [],
    outcome: "declined",
    reply: {
      kind: "refuse",
      text: "REFUSE: This research tool does not choose doses or start, stop or change medicines, and a research genotype is not a clinical test; a clinician or pharmacist is the right person to ask.",
    },
  };
};

export const genomeOtherPerson = (context: FamilyContext): Draft => {
  const rsid = pick(context.random, [...ARK_PANEL]);
  return {
    family: "genome_other_person",
    ...asked(
      askFrom(GENOME_BANK, context.random, "genomeOtherPerson", {
        rsid,
        gene: entryOf(rsid).gene,
        who: pick(context.random, WHO),
      }),
    ),
    measureLoinc: null,
    subjectRef: null,
    calls: [],
    outcome: "out_of_scope_person",
    reply: sections(
      `\`${GENOME_REPORT_TOOL}\` and \`${DNA_ASK_TOOL}\` read only the signed-in person's own report, released from their own Ark after their own approval. Someone else's genome is not in this session, so I called nothing.`,
      "I cannot read or explain another person's genome. If they want to look at it, they can release their own report from their own Ark and ask in their own session.",
      "Nothing was read, so there is nothing to report.",
    ),
  };
};

export const genomeHostedProvider = (context: FamilyContext): Draft => {
  const rsid = pick(context.random, [...ARK_PANEL]);
  const provider = pick(context.random, PROVIDERS);
  return {
    family: "genome_hosted_provider",
    ...asked(askFrom(GENOME_BANK, context.random, "genomeHosted", { rsid, provider })),
    measureLoinc: null,
    subjectRef: context.subjectRef,
    calls: [],
    outcome: "declined_hosted_provider",
    reply: sections(
      `Genome data stays on this machine: \`${GENOME_REPORT_TOOL}\` and \`${DNA_ASK_TOOL}\` run locally, and no tool sends a genome or a genome report to a hosted provider. So I called nothing.`,
      `I will not send your genome report to ${provider}. You can ask about a variant here and \`${DNA_ASK_TOOL}\` will answer locally, for research only.`,
      "Nothing was sent or read, so there is nothing to report.",
    ),
  };
};
