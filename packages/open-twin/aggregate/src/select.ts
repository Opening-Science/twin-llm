/**
 * WHAT: Cross-source reconciliation / measure keys / source selection for overlapping Observations.
 * NOT:  Must not fetch vendor data or invent scores for openXR HealthTwinData.
GOVERNED BY: DECISIONS.md#d1; DECISIONS.md#d2; DECISIONS.md#d3; DECISIONS.md#d4
 * CORRECTNESS: NONE — see docs/findings/no-external-authority.md
 * GOTCHA: When evidence ties or energy MAPE is too high, abstain — do not break ties on array order.
 */
import { type ReliabilityFinding, type ReliabilityGrade, reliabilityFor } from '@open-twin/fhir-core';
import type { Measure } from './measure';

/**
 * Choosing between two connectors that measured the same thing.
 *
 * The rule is an evidence lookup, not a preference order. `reliability.ts` records
 * what the validation literature says about a (source, measure) pair, and this reads
 * it — so "Oura is best for sleep" is never assumed, and is in fact wrong as stated:
 * Oura is good at separating sleep from wake and only fair at staging it, and those
 * are different measures with different answers.
 *
 * The most important outcome here is the refusal. Energy expenditure has a published
 * mean absolute percentage error above 30% on every brand tested, so there is no good
 * source to pick — and naming a winner would present a confidence nobody has earned.
 * Where the evidence says no source is dependable, every reading is kept and no
 * derived value is asserted at all.
 */

const RANK: Readonly<Record<ReliabilityGrade, number>> = { good: 3, fair: 2, unknown: 1, poor: 0 };

export interface Candidate {
  /** The connector the reading came from, matching `ReliabilityFinding.source`. */
  connector: string;
}

export type Selection<T extends Candidate> =
  | { kind: 'selected'; winner: T; policy: string }
  | { kind: 'abstained'; reason: string };

/** The best grade published for this connector and measure, and the finding behind it. */
function gradeFor(connector: string, measure: Measure): { grade: ReliabilityGrade; finding?: ReliabilityFinding } {
  const findings = reliabilityFor(connector, measure);
  // `reliabilityFor` returns source-specific findings before the `*` ones that apply to
  // everything, so the first is the most specific statement about this connector.
  const finding = findings[0];
  return { grade: finding?.grade ?? 'unknown', finding };
}

/**
 * Picks a source, or declines to.
 *
 * Declines when the literature says nothing about any candidate — an arbitrary winner
 * dressed as a judgement is worse than no winner — and when a `poor` grade applies,
 * which is the "no source is dependable for this" case rather than a low ranking.
 */
export function selectSource<T extends Candidate>(candidates: T[], measure: Measure): Selection<T> {
  const first = candidates[0];
  if (!first) return { kind: 'abstained', reason: 'no candidates' };
  if (candidates.length === 1) {
    return { kind: 'abstained', reason: 'only one source reported this measure, so nothing was selected' };
  }

  const graded = candidates.map((candidate) => ({ candidate, ...gradeFor(candidate.connector, measure) }));

  const poor = graded.find((entry) => entry.grade === 'poor');
  if (poor) {
    return {
      kind: 'abstained',
      reason:
        `No source is dependable for ${measure}, so every reading is kept and none is preferred. ` +
        (poor.finding?.evidence ?? '')
    };
  }

  if (graded.every((entry) => entry.grade === 'unknown')) {
    return {
      kind: 'abstained',
      reason: `No validation evidence was found for ${measure} from any of these sources, so none was preferred.`
    };
  }

  const best = graded.reduce((a, b) => (RANK[b.grade] > RANK[a.grade] ? b : a));
  const runnerUp = graded.filter((entry) => entry.candidate !== best.candidate);
  // A tie is not a selection. Two sources graded alike give no reason to prefer either,
  // and picking on array order would encode the request order as a clinical judgement.
  if (runnerUp.some((entry) => RANK[entry.grade] === RANK[best.grade])) {
    return {
      kind: 'abstained',
      reason:
        `${measure}: the evidence grades these sources equally (${best.grade}), ` +
        'so there is no basis to prefer one and all readings are kept.'
    };
  }

  const others = runnerUp.map((entry) => `${entry.candidate.connector} (${entry.grade})`).join(', ');
  return {
    kind: 'selected',
    winner: best.candidate,
    policy:
      `${best.candidate.connector} selected for ${measure}: graded ${best.grade} against ${others}. ` +
      `${best.finding?.evidence ?? ''} — ${best.finding?.citation ?? ''}`.trim()
  };
}
