/**
 * The ids an answer writes in brackets to cite a literature source (#612), as
 * the claim reader (`claim-sources.ts`) and the evidence-key parser
 * (`parse-twin-answer.ts`) both read them. Pure.
 */

export const UNSUPPORTED_MARK = "unsupported" as const;

/**
 * Shapes of the ids a search can return: a PMC id, a literature document id,
 * a guideline id ending in its year. A bracketed token of another shape (a
 * wearable key, a footnote number) is not read as a citation at all.
 */
const ID_SHAPES: readonly RegExp[] = [
  /^PMC\d+$/i,
  /^lit-[a-z]+-PMC\d+\.\d+$/i,
  /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*-(?:19|20)\d{2}$/i,
];

export const looksLikeId = (token: string): boolean =>
  ID_SHAPES.some((re) => re.test(token));
