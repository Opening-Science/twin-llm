import type { ClaimCoverage, ReferenceSource } from "@/infrastructure/claim-sources";

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

export const UNSUPPORTED_CITE_LINE =
  "The answer marks this claim as resting on no passage its searches returned";

const count = (n: number, one: string, many: string): string =>
  `${String(n)} ${n === 1 ? one : many}`;

/**
 * One line under an answer whose searches returned literature: how many of
 * its claims cite a returned source, and what the rest do. Null when the
 * answer has no claim.
 */
export const claimSummaryLine = (coverage: ClaimCoverage): string | null => {
  if (coverage.claims === 0) return null;
  const parts = [
    `${String(coverage.cited)} of ${count(coverage.claims, "claim", "claims")} ${coverage.cited === 1 ? "cites" : "cite"} a source the searches returned`,
    ...(coverage.unsupported > 0
      ? [`${String(coverage.unsupported)} marked unsupported`]
      : []),
    ...(coverage.invented > 0
      ? [`${count(coverage.invented, "cites", "cite")} a source no search returned`]
      : []),
    ...(coverage.uncited > 0
      ? [`${count(coverage.uncited, "cites", "cite")} nothing`]
      : []),
  ];
  return `${parts.join("; ")}.`;
};
