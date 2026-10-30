import { LITERATURE_SOURCE_PREFIX } from "./constants";

/**
 * The agent specialties a body of literature is fetched for. Each query is a
 * PMC search in MeSH terms, limited to the PMC Open Access Subset; the licence
 * of every hit is still checked one by one before anything is stored.
 */
export const SPECIALTIES = {
  gp: {
    label: "General",
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
  cardiology: {
    label: "Cardiology",
    query:
      '"arrhythmias, cardiac"[mesh] OR "atrial fibrillation"[mesh] OR "heart rate"[mesh] OR ("photoplethysmography"[mesh] AND "wearable electronic devices"[mesh])',
  },
  neurology: {
    label: "Neurology",
    query:
      '"stroke"[mesh] OR "cerebrovascular disorders"[mesh] OR "autonomic nervous system"[mesh] OR "cognitive dysfunction"[mesh] OR ("sleep"[mesh] AND "cognition"[mesh])',
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

/**
 * Agents whose id is not the name of their specialty (#253). Every other
 * specialist agent reads the specialty with its own id.
 */
const AGENT_SPECIALTIES: Readonly<Record<string, SpecialtyId>> = {
  rhythm: "cardiology",
  brain: "neurology",
};

/** The specialty an agent reads, or null when it has none of its own. */
export const specialtyForAgent = (agentId: string): SpecialtyId | null => {
  if (Object.hasOwn(AGENT_SPECIALTIES, agentId))
    return AGENT_SPECIALTIES[agentId] ?? null;
  return isSpecialtyId(agentId) ? agentId : null;
};

/**
 * The literature an agent's search reads (#236): its own specialty's source,
 * every specialty for the General agent, none for anything else (a
 * plain model, or an agent without a specialty).
 */
export const literatureSourcesForAgent = (
  agentId: string | null | undefined,
): readonly string[] => {
  if (agentId === "gp") return SPECIALTY_IDS.map(literatureSource);
  const specialty = agentId == null ? null : specialtyForAgent(agentId);
  return specialty === null ? [] : [literatureSource(specialty)];
};
