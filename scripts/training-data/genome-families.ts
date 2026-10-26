/**
 * Genome conversation families: questions about the asker's own released
 * rsid-genotypes report, answered with `dna_ask`, plus the cases where the
 * honest answer is a refusal or "there is nothing to read". Pure.
 *
 * The genotypes are the synthetic subject's (`scripts/genome-synth`), so the
 * report quoted in a question is exactly what the Ark app would print for
 * that subject's synthetic VCF. The real Carbon-X output is not available
 * here, so a `dna_ask` result is a fixed text built from the curated catalog
 * row (gene, consequence, ClinVar significance) and says so in its own
 * label. Answers summarise that text, say it is research only and never
 * give a dose, a medicine change or a clinical reading.
 */
import { ARK_PANEL, reportFor } from "../genome-synth/ark-report";
import type { Variant } from "../genome-synth/catalog";
import { alleles, type Call, callsFor } from "../genome-synth/genotypes";
import { pick, type Random } from "../synthetic-wearables/random";

import type { OpenAiTool } from "./chat-tool-list";
import {
  asked,
  DNA_ASK,
  type Draft,
  type FamilyContext,
  sections,
  type ToolCall,
} from "./family-kit";
import { GENOME_BANK, type GenomeSlot } from "./genome-questions";
import { askFrom } from "./questions";

/**
 * The tool as the training records offer it. The chat's own definition comes
 * with the genome bridge; this one has the agreed shape (one `rsid` string)
 * so the records can be generated before it lands.
 */
export const DNA_ASK_TOOL: OpenAiTool = {
  type: "function",
  function: {
    name: DNA_ASK,
    description:
      "Ask the local DNA helper about one rsID from the person's own released Ark genome report. Runs on this machine; returns research-only text, never dosing or clinical advice.",
    parameters: {
      type: "object",
      properties: {
        rsid: {
          type: "string",
          pattern: "^rs[0-9]+$",
          description: "One dbSNP rsID, for example rs4244285.",
        },
      },
      required: ["rsid"],
      additionalProperties: false,
    },
  },
};

export const STAND_IN_LABEL =
  "SYNTHETIC STAND-IN for training, not Carbon-X output. Research use only; not clinical advice.";

export const GENOME_SYNTHETIC_NOTE =
  "The genotypes are synthetic (TwinLLM genome-synth) and describe no real person.";

const words = (term: string) => term.replaceAll("_", " ");

const significance = (variant: Variant): string =>
  variant.clinvar === ""
    ? "no ClinVar significance listed"
    : variant.clinvar.split(";").join(", ");

/** The fixed `dna_ask` result for one catalog row. */
export const standInResult = (variant: Variant) => ({
  rsid: variant.rsid,
  research_only: true,
  synthetic: true,
  label: STAND_IN_LABEL,
  text: `${variant.rsid} is in ${variant.gene} (GRCh38 ${variant.chrom}:${variant.pos} ${variant.ref}>${variant.alt}). Consequence: ${words(variant.consequence)}. ClinVar: ${significance(variant)}.`,
});

const dnaAsk = (variant: Variant): ToolCall => ({
  name: DNA_ASK,
  args: { rsid: variant.rsid },
  result: standInResult(variant),
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

const summary = (variant: Variant): string =>
  `${variant.rsid} lies in ${variant.gene} (${words(variant.consequence)}); ClinVar lists ${significance(variant)}`;

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

const nonEmpty = <T>(items: readonly T[]): readonly [T, ...T[]] | null =>
  items.length > 0 ? (items as readonly [T, ...T[]]) : null;

/** The question, with the released report pasted below it on some turns. */
const withReport = (
  random: Random,
  slot: GenomeSlot,
  values: Readonly<Record<string, string>>,
  report: string,
  always = false,
) => {
  const question = askFrom(GENOME_BANK, random, slot, values);
  const paste = always || random() < 0.5;
  return asked({
    question: paste ? `${question.question}\n\n${report.trimEnd()}` : question.question,
    template: question.template,
  });
};

const called = (genome: Genome) =>
  nonEmpty(genome.panel.filter((call) => call.altCopies !== null));

export const genomeVariant = (context: FamilyContext): Draft | null => {
  const genome = genomeOf(context);
  const pool = called(genome);
  if (pool === null) return null;
  const call = pick(context.random, pool);
  const genotype = alleles(call) ?? "";
  const { variant } = call;
  return {
    family: "genome_variant",
    ...withReport(
      context.random,
      "genomeVariant",
      { rsid: variant.rsid, genotype },
      genome.report,
    ),
    measureLoinc: null,
    subjectRef: context.subjectRef,
    calls: [dnaAsk(variant)],
    outcome: "answered",
    reply: sections(
      `Your released report records ${genotype} at ${variant.rsid}. I called \`${DNA_ASK}\` for ${variant.rsid}; it returned a summary labelled research only and synthetic.`,
      `${summary(variant)}. Your report records ${genotype}: ${copiesText(call)}. ${RESEARCH_ONLY}`,
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
    ...withReport(
      context.random,
      "genomeVariants",
      { a: a.variant.rsid, ga, b: b.variant.rsid, gb },
      genome.report,
    ),
    measureLoinc: null,
    subjectRef: context.subjectRef,
    calls: [dnaAsk(a.variant), dnaAsk(b.variant)],
    outcome: "answered",
    reply: sections(
      `Your released report records ${ga} at ${a.variant.rsid} and ${gb} at ${b.variant.rsid}. I called \`${DNA_ASK}\` once for each; both summaries are labelled research only and synthetic.`,
      `${summary(a.variant)}; your report records ${ga}, ${copiesText(a)}. ${summary(b.variant)}; your report records ${gb}, ${copiesText(b)}. ${RESEARCH_ONLY}`,
      `Each site is read on its own; together they still do not define a star allele or a metaboliser status, and a research genotype is not a clinical test. ${GENOME_SYNTHETIC_NOTE}`,
    ),
  };
};

export const genomeNoCall = (context: FamilyContext): Draft | null => {
  const genome = genomeOf(context);
  const pool = nonEmpty(genome.panel.filter((call) => call.altCopies === null));
  if (pool === null) return null;
  const { variant } = pick(context.random, pool);
  return {
    family: "genome_no_call",
    ...withReport(context.random, "genomeNoCall", { rsid: variant.rsid }, genome.report),
    measureLoinc: null,
    subjectRef: context.subjectRef,
    calls: [dnaAsk(variant)],
    outcome: "no_call",
    reply: sections(
      `Your released report says no call at ${variant.rsid}: the call file had no genotype for that site. I called \`${DNA_ASK}\` for ${variant.rsid} to describe the variant in general; the summary is labelled research only and synthetic.`,
      `There is no genotype for you at ${variant.rsid}, so I cannot say which alleles you carry. A no call is not the reference genotype, and I will not fill it in. In general, ${summary(variant)}.`,
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
    ...withReport(
      context.random,
      "genomeNotInReport",
      { rsid: variant.rsid, gene: variant.gene },
      genome.report,
      true,
    ),
    measureLoinc: null,
    subjectRef: context.subjectRef,
    calls: [],
    outcome: "not_in_report",
    reply: sections(
      `Your released report lists ${ARK_PANEL.length} rsIDs, and ${variant.rsid} is not one of them. I did not call \`${DNA_ASK}\`: it describes a variant, it cannot tell what you carry.`,
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
    ...withReport(
      context.random,
      "genomeDose",
      {
        rsid: call.variant.rsid,
        genotype: alleles(call) ?? "",
        gene: call.variant.gene,
        drug,
      },
      genome.report,
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
  const variant = pick(context.random, [...ARK_PANEL]);
  const gene =
    context.genomeCatalog?.find((entry) => entry.rsid === variant)?.gene ?? "CYP2C19";
  return {
    family: "genome_other_person",
    ...asked(
      askFrom(GENOME_BANK, context.random, "genomeOtherPerson", {
        rsid: variant,
        gene,
        who: pick(context.random, WHO),
      }),
    ),
    measureLoinc: null,
    subjectRef: null,
    calls: [],
    outcome: "out_of_scope_person",
    reply: sections(
      `\`${DNA_ASK}\` reads only the signed-in person's own report, released from their own Ark after their own approval. Someone else's genome is not in this session, so I called nothing.`,
      "I cannot read or explain another person's genome. If they want to look at it, they can release their own report from their own Ark and ask in their own session.",
      "Nothing was read, so there is nothing to report.",
    ),
  };
};

export const genomeHostedProvider = (context: FamilyContext): Draft => {
  const variant = pick(context.random, [...ARK_PANEL]);
  const provider = pick(context.random, PROVIDERS);
  return {
    family: "genome_hosted_provider",
    ...asked(
      askFrom(GENOME_BANK, context.random, "genomeHosted", { rsid: variant, provider }),
    ),
    measureLoinc: null,
    subjectRef: context.subjectRef,
    calls: [],
    outcome: "declined_hosted_provider",
    reply: sections(
      `Genome data stays on this machine: \`${DNA_ASK}\` runs locally, and no tool sends a genome or a genome report to a hosted provider. So I called nothing.`,
      `I will not send your genome report to ${provider}. You can ask about a variant here and \`${DNA_ASK}\` will answer locally, for research only.`,
      "Nothing was sent or read, so there is nothing to report.",
    ),
  };
};
