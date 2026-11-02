import { createHash } from "node:crypto";

import { type RatedSet } from "./rater-rubric";

/**
 * The stratified sample of the v1h human review (#413), as the protocol in
 * `docs/evaluation/question-set.md` ("Human review") states it: from each
 * run, every S5 and S6 line and, per scenario of S1 to S4, up to four lines,
 * chosen by the order of sha256 of `v1h-review.v1`, the run id, the item id
 * and the repeat (lowest first). Pure, server side (it hashes with
 * node:crypto).
 *
 * The rank is public on purpose: it depends on the run files alone, so both
 * raters rate the same lines (kappa between them needs that) and anyone with
 * the runs can redraw the sample. It does not read the automatic score, so
 * nothing about the score can reach the rater through which lines were
 * drawn. Each rater still sees the sample in their own salted order
 * (`seededOrder` in `rater-lines.ts`), which says nothing about scenario or run.
 */

export const REVIEW_SAMPLE_VERSION = "v1h-review.v1";

/** Scenarios whose lines are all in the sample. */
export const WHOLE_SCENARIOS: readonly string[] = ["S5", "S6"];

/** Scenarios sampled up to `PER_SCENARIO_CAP` lines per run. */
export const CAPPED_SCENARIOS: readonly string[] = ["S1", "S2", "S3", "S4"];

export const PER_SCENARIO_CAP = 4;

/** Which lines a rater sees: the protocol's sample, or every answered line (a second pass). */
export type RaterScope = "sample" | "all";

export type SampleCandidate = Readonly<{
  runId: string;
  itemId: string;
  repeat: number;
  scenario: string;
}>;

/**
 * The line's rank in the sample: sha256 hex of the protocol's label, run id,
 * item id and repeat, joined by newlines (the protocol names the parts, not
 * the separator; a newline cannot occur in a run or item id).
 */
export const sampleRank = (runId: string, itemId: string, repeat: number): string =>
  createHash("sha256")
    .update(`${REVIEW_SAMPLE_VERSION}\n${runId}\n${itemId}\n${repeat}`)
    .digest("hex");

const byRank = <T extends SampleCandidate>(lines: readonly T[]): T[] =>
  lines
    .map((line) => ({ line, rank: sampleRank(line.runId, line.itemId, line.repeat) }))
    .sort((a, b) => a.rank.localeCompare(b.rank))
    .map((each) => each.line);

/**
 * The sampled lines among `lines` (the answered lines of one or more runs),
 * in the order they came. Lines of a scenario the protocol does not name are
 * left out. A run with four lines or fewer in a capped scenario keeps them all.
 */
export const reviewSample = <T extends SampleCandidate>(lines: readonly T[]): T[] => {
  const chosen = new Set<T>();
  const runs = [...new Set(lines.map((line) => line.runId))];
  for (const runId of runs) {
    const ofRun = lines.filter((line) => line.runId === runId);
    for (const line of ofRun) {
      if (WHOLE_SCENARIOS.includes(line.scenario)) chosen.add(line);
    }
    for (const scenario of CAPPED_SCENARIOS) {
      for (const line of byRank(ofRun.filter((each) => each.scenario === scenario)).slice(
        0,
        PER_SCENARIO_CAP,
      )) {
        chosen.add(line);
      }
    }
  }
  return lines.filter((line) => chosen.has(line));
};

/**
 * The lines a rater of `set` sees in `scope`: the protocol's sample for v1h,
 * every line with `all`. The hb set has no sampling protocol; it shows every
 * line in either scope.
 */
export const linesInScope = <T extends SampleCandidate>(
  set: RatedSet,
  lines: readonly T[],
  scope: RaterScope,
): T[] => (set === "v1h" && scope === "sample" ? reviewSample(lines) : [...lines]);

/** `?all=1` (or `true`, or the scope name `all`) asks for every line; anything else is the sample. */
export const raterScopeOf = (value: unknown): RaterScope =>
  value === "1" || value === "true" || value === "all" ? "all" : "sample";
