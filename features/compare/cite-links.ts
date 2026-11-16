import type { ReferenceSource } from "@/infrastructure/claim-sources";

/**
 * Words for the citations in a finished answer (#612). Pure. A cited id the
 * turn's searches returned links to its source; an id no search returned is
 * shown as such, never as a link.
 */

const KIND_WORDS: Readonly<Record<ReferenceSource["kind"], string>> = {
  guideline: "Guideline",
  article: "Article",
  note: "OpenTwin note",
};

/** "Guideline: EAN ALS guideline, 2024", the citation's accessible name and tooltip. */
export const citeTitle = (source: ReferenceSource): string =>
  `${KIND_WORDS[source.kind]}: ${source.title}${source.year > 0 ? `, ${String(source.year)}` : ""}`;

export const INVENTED_CITE_LINE = "No search returned this source in this answer";

/** Only a web address opens; anything else stays a plain label. */
export const citeHref = (source: ReferenceSource): string | null =>
  /^https?:\/\//i.test(source.url) ? source.url : null;
