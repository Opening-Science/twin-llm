import {
  ENSEMBL_LOOKUP_TOOL,
  LIVE_SOURCE_IDS,
  type LiveSourceId,
  PUBMED_SEARCH_TOOL,
} from "@/packages/live-sources/constants";

/**
 * Live public lookups (#6) as people see them: what each source is, who
 * receives a lookup, and exactly what leaves this machine and what does not.
 * Customize · Connectors and the first-run flow show the same words.
 *
 * Pure, so the client and the server share it. Unlike the knowledge sources
 * (`knowledge-sources.ts`, stored as an opt-out list), live sources are stored
 * as the ids a person switched *on*, so every live source, and any added
 * later, starts off.
 */

export type { LiveSourceId } from "@/packages/live-sources/constants";
export { LIVE_SOURCE_IDS } from "@/packages/live-sources/constants";

export type LiveSource = Readonly<{
  id: LiveSourceId;
  label: string;
  description: string;
  recipient: string;
  /** What a lookup sends, in plain words. */
  sends: string;
  /** What never goes with it. */
  keeps: string;
  tools: readonly string[];
}>;

const KEEPS =
  "Your messages, the answers, your wearable values, records, imported files, genome and twin notes. A query with a number outside a gene symbol or rsID, a year, an address or an identifier is refused before it is sent.";

export const LIVE_SOURCES: readonly LiveSource[] = [
  {
    id: "pubmed",
    label: "PubMed",
    description:
      "Searches published articles and gives titles, journals, years, DOIs and short abstract snippets to cite.",
    recipient: "NCBI (US National Library of Medicine)",
    sends:
      "The search terms the model writes for a lookup, then the PubMed ids NCBI sent back, to fetch their titles and abstracts. Each request names this app, and the operator's contact address when one is set. NCBI also sees this machine's internet address.",
    keeps: KEEPS,
    tools: [PUBMED_SEARCH_TOOL],
  },
  {
    id: "ensembl",
    label: "Ensembl",
    description:
      "Looks up one human gene by symbol or one variant by rsID, with its location and published annotations.",
    recipient: "Ensembl (EMBL-EBI)",
    sends:
      "One gene symbol or rsID per lookup. Ensembl also sees this machine's internet address.",
    keeps: `${KEEPS} While your genome is part of a chat, no rsID is sent.`,
    tools: [ENSEMBL_LOOKUP_TOOL],
  },
];

/** Shown instead of a switch when the server runs in local-only mode. */
export const LIVE_SOURCES_LOCAL_ONLY_NOTE =
  "Off on this server: local-only mode sends nothing to public databases.";

/** One line for every switch: when nothing is sent at all. */
export const LIVE_SOURCES_NEVER_NOTE =
  "Off by default. Never used in incognito chats or in local-only mode. Every lookup is listed under Customize · Privacy before it is sent.";

export const isLiveSourceId = (value: unknown): value is LiveSourceId =>
  typeof value === "string" && (LIVE_SOURCE_IDS as readonly string[]).includes(value);

/** Stored ids, cleaned: unknown values and duplicates go, order follows the catalogue. */
export const normaliseLiveSources = (raw: unknown): readonly LiveSourceId[] => {
  if (!Array.isArray(raw)) return [];
  const wanted = new Set(raw.filter(isLiveSourceId));
  return LIVE_SOURCE_IDS.filter((id) => wanted.has(id));
};

export const setLiveSourceEnabled = (
  enabled: readonly LiveSourceId[],
  id: LiveSourceId,
  on: boolean,
): readonly LiveSourceId[] =>
  normaliseLiveSources(on ? [...enabled, id] : enabled.filter((item) => item !== id));
