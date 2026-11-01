import { z } from "zod";

import { CARBON_X_LABEL, DNA_ASK_TOOL, GENOME_REPORT_TOOL } from "./constants";

/**
 * Input schemas of the two genome chat tools. The model names a site by rsID
 * and nothing else: it never supplies coordinates, alleles or sequence, so it
 * cannot point Carbon-X at anything outside the released report.
 */

export const RSID = /^rs[1-9]\d{0,11}$/;

export const dnaAskInput = z
  .object({
    rsid: z
      .string()
      .regex(RSID)
      .describe("An rsID from the released genome report, such as rs4244285"),
    question: z
      .string()
      .min(1)
      .max(300)
      .optional()
      .describe("What to ask about this variant; left out, a description of its effect"),
  })
  .strict()
  .describe("Ask the local Carbon-X DNA model about one variant in the released report");

export const genomeReportInput = z
  .object({})
  .strict()
  .describe("Read the released Ark genome report");

export const GENOME_TOOL_DEFINITIONS = [
  {
    name: GENOME_REPORT_TOOL,
    description:
      "Read the owner's released Ark rsid-genotypes report: each panel site with its gene, star allele, position and genotype or no call (the call file has nothing there; not the reference allele). Research use only.",
    input: genomeReportInput,
  },
  {
    name: DNA_ASK_TOOL,
    description: `Ask Carbon-X, a local research DNA model, about one variant in the released report. The server builds the DNA windows from the public GRCh38 reference and the recorded genotype; give only the rsID. Quote its answer labelled ${CARBON_X_LABEL}: research output, not a fact about the person. Say what a variant is known to affect; never give a dose or say to start, stop or change a medicine.`,
    input: dnaAskInput,
  },
] as const;
