import { z } from "zod";

import { datasetIdSchema } from "./imported-schemas";
import { GENOME_VARIANTS_TOOL } from "./imported-names";

/**
 * Input of `genome_variants` (#307): one imported VCF and the variants to look
 * up in it, by name only. The names are checked by the tool, not here, so a
 * list that is too long or holds a name it cannot read gets a coded refusal
 * the model can act on.
 */

export const genomeVariantsInput = z
  .object({
    dataset_id: datasetIdSchema.describe("dataset_id of the person's imported VCF"),
    variants: z
      .array(z.string().max(64))
      .min(1)
      .describe('rsIDs or GRCh38 sites written "chrN:pos", at most 50'),
  })
  .strict()
  .describe("Look up named variants in the person's imported VCF");

export const GENOME_VARIANTS_TOOL_DEFINITION = {
  name: GENOME_VARIANTS_TOOL,
  description:
    "Look up named variants (rsID or chrN:pos, at most 50) in the person's own imported VCF: for each, found or not, and chrom, pos, ref, alt, genotype and filter as the file wrote them. No ranges or scans. Local models only; research use only.",
  input: genomeVariantsInput,
} as const;
