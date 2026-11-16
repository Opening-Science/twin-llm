/**
 * Claim sources (#612): how many claims of an answer link to a source its
 * searches returned, are marked `[unsupported]`, cite an id no search gave,
 * or cite nothing. Counted by the matcher the answer view uses
 * (`infrastructure/claim-sources.ts`), only on lines whose turn returned a
 * guideline passage or an article: a turn with no literature has nothing to
 * cite. An extra metric; no pass or fail depends on it.
 */
import {
  answerClaims,
  type ClaimCoverage,
  claimCoverage,
  referenceSources,
} from "../../../infrastructure/claim-sources";

import type { ScoreInput } from "./types";

export const scoreClaimSources = ({
  line,
}: Pick<ScoreInput, "line">): ClaimCoverage | null => {
  const parts = line.tool_results.map((result) => ({ output: result.output }));
  const literature = [...referenceSources(parts).values()].some(
    (source) => source.kind !== "note",
  );
  return literature ? claimCoverage(answerClaims(line.text ?? "", parts)) : null;
};
