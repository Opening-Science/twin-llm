/**
 * Literature citations per turn (#236), drained into the response document's
 * `sources.literature`. Metadata only, never the passage.
 */
import type { LiteratureHit } from "./hit";

export type LiteratureCitation = Readonly<{
  tool: string;
  id: string;
  title: string;
  journal: string;
  year: number;
  pmcid: string;
  url: string;
  doi: string;
  licence: string;
  licenceLabel: string;
  sectionHeading: string;
}>;

export type LiteratureTurn = Readonly<{
  sources: readonly LiteratureCitation[];
}>;

export const toLiteratureCitation = (
  tool: string,
  hit: LiteratureHit,
): LiteratureCitation => ({
  tool,
  id: hit.id,
  title: hit.title,
  journal: hit.journal,
  year: hit.year,
  pmcid: hit.pmcid,
  url: hit.url,
  doi: hit.doi,
  licence: hit.licence,
  licenceLabel: hit.licenceLabel,
  sectionHeading: hit.sectionHeading,
});

const turns = new Map<string, readonly LiteratureCitation[]>();

export const recordLiteratureTurn = (
  sessionId: string,
  sources: readonly LiteratureCitation[],
): void => {
  turns.set(sessionId, [...(turns.get(sessionId) ?? []), ...sources]);
};

export const drainLiteratureTurn = (sessionId: string): LiteratureTurn => {
  const sources = turns.get(sessionId) ?? [];
  turns.delete(sessionId);
  return { sources };
};

export const resetLiteratureCollectorForTests = (): void => {
  turns.clear();
};
