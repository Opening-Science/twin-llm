/**
 * Literature passages as an agent's search shows them to the model (#236).
 * Pure. Every hit names the article title, its PMC id and its licence, says
 * how it may be quoted, and says it is not about the person: an article is
 * reference material and never person-level evidence.
 */
import type { GuidelineJoinedRow } from "@/packages/guidelines/search";

import { LITERATURE_SOURCE_PREFIX } from "./constants";
import { isLiteratureLicence, LICENCE_TERMS, type LiteratureLicence } from "./licence";
import { isSpecialtyId, type SpecialtyId } from "./specialties";

export type LiteratureHit = Readonly<{
  kind: "literature";
  /** Document id, `lit-<specialty>-<pmcid>.<version>`. */
  id: string;
  specialty: SpecialtyId;
  title: string;
  journal: string;
  /** 0 when the PMC citation had no year. */
  year: number;
  pmcid: string;
  url: string;
  doi: string;
  licence: LiteratureLicence;
  /** "CC BY-NC-ND". */
  licenceLabel: string;
  sectionHeading: string;
  /** The stored article text, unchanged. */
  passage: string;
  /** The line to put next to any quote from this passage. */
  attribution: string;
  /** How this passage may be quoted, from its licence. */
  quoting: string;
  about: string;
}>;

/** The `literature:<specialty>` source's specialty, or null for any other source. */
export const specialtyOfSource = (source: string): SpecialtyId | null => {
  if (!source.startsWith(LITERATURE_SOURCE_PREFIX)) return null;
  const id = source.slice(LITERATURE_SOURCE_PREFIX.length);
  return isSpecialtyId(id) ? id : null;
};

/** `PMC1234567` from a document id `lit-diet-PMC1234567.2`, or null. */
export const pmcidOfDocumentId = (documentId: string): string | null =>
  documentId.match(/^lit-[a-z]+-(PMC\d+)\.\d+$/)?.[1] ?? null;

/** NoDerivatives licences: the text may be quoted only as it stands. */
export const isNoDerivatives = (licence: LiteratureLicence): boolean =>
  licence === "cc-by-nd" || licence === "cc-by-nc-nd";

export const LITERATURE_ABOUT =
  "Published article as reference material, not a statement about this person." as const;

const QUOTE_RULE =
  "Quote only word for word from passage, with the attribution line next to the quote.";

export const quotingRule = (licence: LiteratureLicence): string =>
  isNoDerivatives(licence)
    ? `${QUOTE_RULE} Its ${LICENCE_TERMS[licence].label} licence allows no changes: quote it unchanged or not at all, never shortened, reworded or translated.`
    : QUOTE_RULE;

export const literatureAttribution = (
  hit: Pick<LiteratureHit, "title" | "journal" | "year" | "pmcid" | "licenceLabel">,
): string =>
  [
    `"${hit.title}"`,
    hit.year > 0 ? `${hit.journal}, ${hit.year}` : hit.journal,
    hit.pmcid,
    hit.licenceLabel,
    "via PubMed Central (NLM)",
  ].join(". ") + ".";

/**
 * The ingest puts the article title in front of every chunk for retrieval
 * (`chunkLiteratureArticle`); the passage shown is the article text alone.
 */
export const articlePassage = (title: string, text: string): string => {
  const prefix = `${title} · `;
  return text.startsWith(prefix) ? text.slice(prefix.length) : text;
};

/**
 * A literature row as a hit, or null when the row is not from a literature
 * source or its id or licence cannot be read: such a row is not shown at all.
 */
export const toLiteratureHit = (row: GuidelineJoinedRow): LiteratureHit | null => {
  const specialty = specialtyOfSource(row.source);
  const pmcid = pmcidOfDocumentId(row.documentId);
  if (specialty === null || pmcid === null || !isLiteratureLicence(row.licence)) {
    return null;
  }
  const base = {
    title: row.title,
    journal: row.society,
    year: row.year,
    pmcid,
    licenceLabel: LICENCE_TERMS[row.licence].label,
  };
  return {
    kind: "literature",
    id: row.documentId,
    specialty,
    ...base,
    url: row.url,
    doi: row.doi,
    licence: row.licence,
    sectionHeading: row.sectionHeading,
    passage: articlePassage(row.title, row.text),
    attribution: literatureAttribution(base),
    quoting: quotingRule(row.licence),
    about: LITERATURE_ABOUT,
  };
};
