/**
 * The messages sent to Carbon-X for one variant. Pure.
 *
 * Every base inside <dna>…</dna> comes from the public GRCh38 reference; the
 * only personal part is the recorded genotype, which decides which alternate
 * window is included. Gene and star-allele context is public CPIC / PharmGKB
 * text. The system message keeps the answer descriptive: what the variant
 * is known to change, never what anyone should take or at what dose.
 */

export type CarbonXMessage = Readonly<{ role: "system" | "user"; content: string }>;

export type VariantContext = Readonly<{
  rsid: string;
  gene: string;
  allele: string;
  geneNote: string;
  chromosome: string;
  position: number;
  build: "GRCh38";
  reference: string;
  genotype: string;
  windowStart: number;
  flank: number;
  referenceWindow: string;
  alternates: readonly Readonly<{ allele: string; sequence: string }>[];
}>;

export const CARBON_X_SYSTEM = [
  "You are Carbon-X, a DNA language model used for research.",
  "Describe what is known about the variant and how the alternate sequence differs from the reference: the change, its position in the gene, and the molecular effect reported in public literature.",
  "Never give clinical advice, dosing, or a recommendation to start, stop or change any medicine. Do not tell the person what to do.",
  "Say plainly when something is unknown. Keep the answer under 200 words.",
].join(" ");

const DEFAULT_QUESTION =
  "Describe what this variant is known to affect, and how the alternate sequence differs from the reference.";

export const buildCarbonXMessages = (
  variant: VariantContext,
  question?: string,
): readonly CarbonXMessage[] => {
  const site = `${variant.chromosome}:${variant.position} (${variant.build}, 1-based)`;
  const windows = [
    `Reference window, ${variant.chromosome}:${variant.windowStart} onward, ${variant.flank} bp each side, reference allele ${variant.reference}:`,
    `<dna>${variant.referenceWindow}</dna>`,
    ...variant.alternates.flatMap((alternate) => [
      `Alternate window with ${alternate.allele} in place of ${variant.reference}:`,
      `<dna>${alternate.sequence}</dna>`,
    ]),
  ];
  const user = [
    `Variant ${variant.rsid} at ${site}, reference allele ${variant.reference}.`,
    `Gene ${variant.gene} (${variant.geneNote}); this site defines ${variant.gene} ${variant.allele} in the CPIC / PharmGKB allele tables.`,
    `Recorded genotype: ${variant.genotype}.`,
    variant.alternates.length === 0
      ? "Both recorded alleles equal the reference, so there is no alternate window."
      : null,
    "",
    ...windows,
    "",
    question?.trim() || DEFAULT_QUESTION,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
  return [
    { role: "system", content: CARBON_X_SYSTEM },
    { role: "user", content: user },
  ];
};
