import { LITERATURE_SOURCE_PREFIX } from "./constants";

/**
 * The agent specialties a body of literature is fetched for. Each query is a
 * PMC search in MeSH terms, limited to the PMC Open Access Subset; the licence
 * of every hit is still checked one by one before anything is stored.
 */
export const SPECIALTIES = {
  gp: {
    label: "General Practitioner",
    query: '"primary health care"[mesh] OR "general practice"[mesh]',
  },
  diet: {
    label: "Diet",
    query: '"diet"[mesh] OR "nutritional physiological phenomena"[mesh]',
  },
  anatomy: {
    label: "Anatomy",
    query: '"anatomy"[mesh]',
  },
  sleep: {
    label: "Sleep",
    query: '"sleep"[mesh] OR "sleep wake disorders"[mesh]',
  },
  trainer: {
    label: "Trainer",
    query: '"exercise"[mesh] OR "sports"[mesh] OR "physical fitness"[mesh]',
  },
  genetics: {
    label: "Genetics",
    query:
      '"genetics, medical"[mesh] OR "pharmacogenetics"[mesh] OR "genetic predisposition to disease"[mesh]',
  },
} as const satisfies Readonly<
  Record<string, { readonly label: string; readonly query: string }>
>;

export type SpecialtyId = keyof typeof SPECIALTIES;

export const SPECIALTY_IDS = Object.keys(SPECIALTIES) as readonly SpecialtyId[];

export const isSpecialtyId = (value: string): value is SpecialtyId =>
  (SPECIALTY_IDS as readonly string[]).includes(value);

/** `guideline_documents.source` for one specialty, e.g. `literature:diet`. */
export const literatureSource = (specialty: SpecialtyId): string =>
  `${LITERATURE_SOURCE_PREFIX}${specialty}`;

/** The PMC search term: the specialty's MeSH query, open access only. */
export const specialtySearchTerm = (specialty: SpecialtyId, query?: string): string =>
  `(${query ?? SPECIALTIES[specialty].query}) AND "open access"[filter]`;
