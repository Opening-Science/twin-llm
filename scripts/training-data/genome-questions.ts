/**
 * Question templates for the genome families, in the same four styles and
 * with the same ids, groups and typo rule as `questions.ts` (`askFrom`). A
 * bank of its own, so the main bank's templates, counts and split groups stay
 * as they are when the genome families are off. Questions are in the first
 * person: the asker's own report, released from their own Ark. Pure.
 */
import { type Bank, STYLES } from "./questions";

/** Placeholders: {rsid} {genotype} {gene} {a} {ga} {b} {gb} {drug} {who} {provider}. */
export const GENOME_BANK = {
  genomeVariant: {
    formal: [
      "My genome report shows {genotype} at {rsid}. What is known about this variant?",
      "Please explain the {rsid} result in my report ({genotype}).",
      "What does {genotype} at {rsid} in my released report refer to?",
    ],
    casual: [
      "my report says {genotype} for {rsid}, what's that about?",
      "got {genotype} at {rsid} in my dna report, what does it mean?",
    ],
    terse: ["{rsid} {genotype}, meaning?", "explain {rsid} = {genotype}"],
    non_native: [
      "In my genome report is written {genotype} at {rsid}. What means this?",
      "Please explain me the variant {rsid}, I have {genotype}.",
    ],
  },
  genomeVariants: {
    formal: [
      "My report lists {ga} at {a} and {gb} at {b}. What are these two variants?",
      "Please summarise {a} ({ga}) and {b} ({gb}) from my genome report.",
    ],
    casual: [
      "what about {a} ({ga}) and {b} ({gb}) in my report?",
      "can you look at {a} and {b} for me? report says {ga} and {gb}",
    ],
    terse: ["{a} {ga}, {b} {gb}: explain", "explain {a} and {b} from my report"],
    non_native: [
      "I have {ga} at {a} and {gb} at {b}. What are these variants?",
      "Please tell me about {a} and {b} of my report ({ga}, {gb}).",
    ],
  },
  genomeNoCall: {
    formal: [
      "My report says 'no call' at {rsid}. What does that mean for me?",
      "Why is {rsid} listed as no call in my genome report, and what is the variant?",
    ],
    casual: [
      "{rsid} just says no call in my report, is that bad?",
      "what does no call mean for {rsid}?",
    ],
    terse: ["{rsid} no call?", "no call at {rsid}, meaning"],
    non_native: [
      "In my report for {rsid} is 'no call'. What it means?",
      "Please explain why {rsid} has no call in my genome report.",
    ],
  },
  genomeNotInReport: {
    formal: [
      "What is my genotype at {rsid}?",
      "Do I carry the {gene} variant {rsid}, according to my released report?",
    ],
    casual: ["do i have {rsid}? check my report", "what's my {rsid} genotype ({gene})?"],
    terse: ["my genotype {rsid}?", "{rsid} ({gene}) in my report?"],
    non_native: [
      "Which genotype I have at {rsid}? Please look in my report.",
      "Please check if I am carrier of {rsid} in {gene}.",
    ],
  },
  genomeDose: {
    formal: [
      "My report shows {genotype} at {rsid} in {gene}. What dose of {drug} should I take?",
      "Given {genotype} at {rsid}, should I change my {drug} dose?",
      "With {gene} {rsid} {genotype}, is it safe for me to keep taking {drug}?",
    ],
    casual: [
      "i'm {genotype} at {rsid}, how much {drug} should i take?",
      "should i stop {drug}? my {gene} result is {genotype}",
    ],
    terse: ["{drug} dose for {rsid} {genotype}?", "{gene} {genotype}: adjust {drug}?"],
    non_native: [
      "I have {genotype} at {rsid}. Which dose of {drug} is good for me?",
      "Must I change the {drug} because of my {gene} result {genotype}?",
    ],
  },
  genomeOtherPerson: {
    formal: [
      "My {who} sent me their genome report. What does their {rsid} result mean?",
      "Please read my {who}'s {gene} variants from their Ark report.",
    ],
    casual: [
      "can you check my {who}'s dna report for {rsid}?",
      "what does my {who}'s {gene} result say?",
    ],
    terse: ["{who}'s {rsid}?", "check {who} genome, {gene}"],
    non_native: [
      "Please look in the genome of my {who} for {rsid}.",
      "My {who} has also a report. What means the {gene} of my {who}?",
    ],
  },
  genomeHosted: {
    formal: [
      "Please send my genome report to {provider} for a second opinion.",
      "Can you run my {rsid} result through {provider} instead of the local model?",
    ],
    casual: [
      "just ask {provider} about my genome, it's smarter",
      "can you upload my dna report to {provider}?",
    ],
    terse: ["send genome to {provider}", "{rsid} via {provider} pls"],
    non_native: [
      "Please give my genome report to {provider}, I want second opinion.",
      "Can you ask {provider} about my variant {rsid}?",
    ],
  },
} as const satisfies Readonly<Record<string, Bank>>;

export type GenomeSlot = keyof typeof GENOME_BANK;

/** Every genome template, flat, with its id and group. */
export const GENOME_TEMPLATES = (Object.keys(GENOME_BANK) as GenomeSlot[]).flatMap(
  (slot) =>
    STYLES.flatMap((style) =>
      GENOME_BANK[slot][style].map((text: string, index: number) => ({
        id: `${slot}.${style}.${index + 1}`,
        group: `${slot}.${style}`,
        style,
        text,
      })),
    ),
);
