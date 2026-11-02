/**
 * Agreement between a second rater and the automatic scorer, or between two
 * raters (#351). Pure; `agreement-run.ts` reads the files.
 *
 * Cohen's kappa (Cohen 1960, "A coefficient of agreement for nominal
 * scales", Educational and Psychological Measurement 20:37-46): observed
 * agreement p_o, chance agreement p_e from the two raters' margins, and
 * kappa = (p_o - p_e) / (1 - p_e). Unweighted: a 5 against a 4 is as much a
 * disagreement as a 5 against a 1.
 *
 * The 95 % interval is kappa ± 1.96·se with the large-sample standard error
 * of Fleiss, Cohen and Everitt (1969, "Large sample standard errors of kappa
 * and weighted kappa", Psychological Bulletin 72:323-327), cut to [-1, 1].
 * It is an approximation; with about 30 lines it is wide, and the doc says
 * so (`docs/evaluation/second-rater.md`).
 *
 * When every line falls in one category for both, p_e is 1 and kappa is not
 * defined: the result says so with `kappa: null` and keeps p_o. When only
 * one side used a single category, kappa is 0 and the standard error
 * formula gives 0, which is not a real certainty: the interval is null.
 */
import { lineToken } from "../../features/lab/rater-lines";
import {
  isAcceptable,
  type RatedSet,
  ratedSetOfRubric,
} from "../../features/lab/rater-rubric";

const Z_95 = 1.959963984540054;

export type Kappa = Readonly<{
  n: number;
  observed: number;
  expected: number;
  /** Null when p_e is 1 (one category only). */
  kappa: number | null;
  se: number | null;
  low: number | null;
  high: number | null;
}>;

/** Kappa of paired labels (first rater, second rater); null when there are no pairs. */
export const cohenKappa = (
  pairs: readonly (readonly [string, string])[],
): Kappa | null => {
  const n = pairs.length;
  if (n === 0) return null;
  const categories = [...new Set(pairs.flat())];
  const cell = (a: string, b: string) =>
    pairs.filter((pair) => pair[0] === a && pair[1] === b).length / n;
  const row = (a: string) => pairs.filter((pair) => pair[0] === a).length / n;
  const column = (b: string) => pairs.filter((pair) => pair[1] === b).length / n;
  const observed = categories.reduce((sum, c) => sum + cell(c, c), 0);
  const expected = categories.reduce((sum, c) => sum + row(c) * column(c), 0);
  if (expected >= 1 - 1e-12) {
    return { n, observed, expected: 1, kappa: null, se: null, low: null, high: null };
  }
  const kappa = (observed - expected) / (1 - expected);
  const oneSided = [0, 1].some(
    (side) => new Set(pairs.map((pair) => pair[side as 0 | 1])).size === 1,
  );
  if (oneSided) {
    return { n, observed, expected, kappa, se: null, low: null, high: null };
  }
  const diagonal = categories.reduce(
    (sum, c) => sum + cell(c, c) * (1 - (row(c) + column(c)) * (1 - kappa)) ** 2,
    0,
  );
  const offDiagonal =
    (1 - kappa) ** 2 *
    categories.reduce(
      (sum, a) =>
        sum +
        categories.reduce(
          (inner, b) =>
            a === b ? inner : inner + cell(a, b) * (column(a) + row(b)) ** 2,
          0,
        ),
      0,
    );
  const variance =
    (diagonal + offDiagonal - (kappa - expected * (1 - kappa)) ** 2) /
    (n * (1 - expected) ** 2);
  const se = Math.sqrt(Math.max(0, variance));
  return {
    n,
    observed,
    expected,
    kappa,
    se,
    low: Math.max(-1, kappa - Z_95 * se),
    high: Math.min(1, kappa + Z_95 * se),
  };
};

/** Pairs from a square table of counts: row = first rater, column = second. */
export const pairsFromTable = (
  table: readonly (readonly number[])[],
): [string, string][] =>
  table.flatMap((row, i) =>
    row.flatMap((count, j) =>
      Array.from({ length: count }, (): [string, string] => [String(i), String(j)]),
    ),
  );

export type ScorerOutcome = "pass" | "fail";

/** One run as the comparison needs it, every map keyed by `item_id#repeat`. */
export type RunAgreementInput = Readonly<{
  runId: string;
  /** The automatic scorer's pass or fail; lines it scored n/a or human are left out. */
  scorer: ReadonlyMap<string, ScorerOutcome>;
  /** Pseudonym → that rater's level per line. */
  raters: ReadonlyMap<string, ReadonlyMap<string, number>>;
}>;

export type AgreementRow = Readonly<{
  comparison: string;
  result: Kappa | null;
}>;

const acceptable = (level: number): string => (isAcceptable(level) ? "pass" : "fail");

/** Pairs over lines both sides have, pooled over runs. */
const pooled = <A, B>(
  runs: readonly RunAgreementInput[],
  left: (run: RunAgreementInput) => ReadonlyMap<string, A> | undefined,
  right: (run: RunAgreementInput) => ReadonlyMap<string, B> | undefined,
  label: (a: A, b: B) => readonly [string, string],
): [string, string][] =>
  runs.flatMap((run) => {
    const a = left(run);
    const b = right(run);
    if (a === undefined || b === undefined) return [];
    return [...a.entries()].flatMap(([key, value]) => {
      const other = b.get(key);
      return other === undefined ? [] : [[...label(value, other)] as [string, string]];
    });
  });

/**
 * Each rater against the scorer (a level of 4 or 5 counts as a pass), and
 * each pair of raters on the five levels and on acceptable or not.
 */
export const agreementRows = (runs: readonly RunAgreementInput[]): AgreementRow[] => {
  const raters = [...new Set(runs.flatMap((run) => [...run.raters.keys()]))].sort();
  const againstScorer = raters.map((rater) => ({
    comparison: `${rater} vs scorer (correctness; 4–5 = pass)`,
    result: cohenKappa(
      pooled(
        runs,
        (run) => run.raters.get(rater),
        (run) => run.scorer,
        (level: number, outcome: ScorerOutcome) => [acceptable(level), outcome],
      ),
    ),
  }));
  const pairsOfRaters = raters.flatMap((first, index) =>
    raters.slice(index + 1).flatMap((second) => {
      const both = (label: (a: number, b: number) => readonly [string, string]) =>
        pooled(
          runs,
          (run) => run.raters.get(first),
          (run) => run.raters.get(second),
          label,
        );
      return [
        {
          comparison: `${first} vs ${second} (five levels)`,
          result: cohenKappa(both((a, b) => [String(a), String(b)])),
        },
        {
          comparison: `${first} vs ${second} (4–5 vs 1–3)`,
          result: cohenKappa(both((a, b) => [acceptable(a), acceptable(b)])),
        },
      ];
    }),
  );
  return [...againstScorer, ...pairsOfRaters];
};

export type AnswerIdRow = Readonly<{
  rater: string;
  id: string;
  runId: string;
  itemId: string;
  repeat: number;
}>;

/**
 * The answer ids one rater's page used for these lines of one run (#355),
 * recomputed from the rater's salt, so an id a rater quotes can be traced to
 * its run. Sorted by id.
 */
export const answerIdRows = (
  rater: string,
  salt: string,
  runId: string,
  lines: readonly Readonly<{ item_id: string; repeat: number }>[],
): AnswerIdRow[] =>
  lines
    .map((line) => ({
      rater,
      id: lineToken(salt, runId, line.item_id, line.repeat),
      runId,
      itemId: line.item_id,
      repeat: line.repeat,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

/**
 * The runs grouped by question set (#304), sets in the order they first
 * appear and runs in the order given, so agreement is never pooled across
 * sets whose rubrics differ.
 */
export const groupBySet = <T extends Readonly<{ set: string }>>(
  runs: readonly T[],
): [string, T[]][] =>
  [...new Set(runs.map((run) => run.set))].map((set) => [
    set,
    runs.filter((run) => run.set === set),
  ]);

/**
 * The rated set a ratings file belongs in a run of `set`: the set itself when
 * the file's rubric is that set's rubric, otherwise null (the file is left
 * out: its levels mean something else, or the set is not rated at all).
 */
export const ratedSetForFile = (set: string, rubric: string): RatedSet | null => {
  const rated = ratedSetOfRubric(rubric);
  return rated !== null && rated === set ? rated : null;
};
