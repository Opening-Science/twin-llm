/**
 * The one chunk a catalogue-only guideline gets (#272). It holds the
 * catalogue fields and nothing from the publication itself, so a cite-only
 * title can be found by `guideline_search` without loading any of its text.
 * `toGuidelineHit` still sends `passage: null` for it.
 */
export const CATALOGUE_SECTION_HEADING = "Catalogue entry" as const;

export type CatalogueFields = {
  readonly title: string;
  readonly year: number;
  readonly society: string;
  readonly doi: string;
  readonly url: string;
};

/** Pure: the embedded text of a catalogue chunk, built from catalogue fields only. */
export const catalogueChunkText = (entry: CatalogueFields): string =>
  [
    `${entry.title} guideline.`,
    `Published by ${entry.society} in ${entry.year}.`,
    `DOI ${entry.doi}, ${entry.url}.`,
    "Catalogue entry only: the full text is not in the library.",
  ].join(" ");
