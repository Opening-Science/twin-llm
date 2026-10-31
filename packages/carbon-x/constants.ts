import { GENOME_VARIANTS_TOOL } from "@/packages/query-tools/imported-names";

/**
 * Names shared by the Carbon-X client, the genome chat tools, the skill
 * gate and the tool cards. Pure, so the browser can import it.
 */

/** The model name the sidecar serves. */
export const CARBON_X_MODEL = "carbon-x" as const;

/** How every Carbon-X answer is labelled wherever it is shown. */
export const CARBON_X_LABEL = "Carbon-X (research model)" as const;

export const CARBON_X_RESEARCH_NOTE =
  "Research model output about a DNA sequence. Not clinical advice and not a basis for any dosing or medicine decision.";

/** Model-facing tool names. */
export const DNA_ASK_TOOL = "dna_ask" as const;
export const GENOME_REPORT_TOOL = "genome_report" as const;

/**
 * Every chat tool that reads a genome, held to the genome policy: the two
 * above, and `genome_variants` over an imported VCF (#307).
 */
export const GENOME_TOOLS: readonly string[] = [
  GENOME_REPORT_TOOL,
  DNA_ASK_TOOL,
  GENOME_VARIANTS_TOOL,
];

/** Audit-chain tool names. */
export const DNA_ASK_AUDIT_TOOL = "genome.dna_ask" as const;
export const GENOME_REPORT_AUDIT_TOOL = "genome.report" as const;
export const GENOME_RUN_AUDIT_TOOL = "genome.report.store" as const;
