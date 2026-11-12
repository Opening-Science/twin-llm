/**
 * A paired comparison of two runs on the same items. Pure; `compare-run.ts`
 * reads the files.
 *
 * The unit is an item by default: its repeats are folded into one outcome
 * by majority (`itemOutcome`), a tie counting as not passed. With the line
 * unit, a sensitivity analysis, each repeat is its own pair. Consistency is
 * scored once per item either way. A pair counts only when both sides are
 * pass or fail. A unit in one run only, or one where either side is skipped
 * (`MISSING_ENV`), an error, `human` or `na`, is left out and counted under
 * the first of those reasons that fits.
 *
 * Each criterion gets the exact two-sided McNemar test: under the null, a
 * discordant pair is equally likely to go either way, so the smaller of the
 * two discordant counts is binomial with n = b + c and p = 1/2, and the
 * p-value is twice its lower tail, capped at 1 (McNemar 1947, "Note on the
 * sampling error of the difference between correlated proportions or
 * percentages", Psychometrika 12:153-157; the exact form as in Fagerland,
 * Lydersen and Laake 2013, BMC Medical Research Methodology 13:91). With no
 * discordant pair p is 1.
 *
 * Holm's step-down adjustment (Holm 1979, Scandinavian Journal of Statistics
 * 6:65-70) runs across the criteria of one comparison that have at least one
 * pair. `familyHolm` adjusts again across every criterion of every
 * comparison read together, as a sensitivity column. Repeats of an item are
 * not independent, so the line unit leans slightly liberal on the few
 * repeated items; the item unit does not.
 */
import type { ResultLine } from "./eval-results";
import type { Question } from "./question-set";
import {
  type Outcome,
  SCORED_CRITERIA,
  type ScoredCriterion,
  type ScoredLine,
} from "./score/score-run";
import { applies, isAnswered } from "./score/types";

export type UnitOutcome = Outcome | "skipped";

export const UNITS = ["item", "line"] as const;

export type Unit = (typeof UNITS)[number];

export const isUnit = (value: string): value is Unit =>
  (UNITS as readonly string[]).includes(value);

/** criterion → unit key → outcome. Line criteria use `<item>#<repeat>`, consistency `<item>`. */
export type RunOutcomes = ReadonlyMap<ScoredCriterion, ReadonlyMap<string, UnitOutcome>>;

export const unitKey = (itemId: string, repeat?: number): string =>
  repeat === undefined ? itemId : `${itemId}#${repeat}`;

export type OutcomesInput = Readonly<{
  items: readonly Question[];
  /** The lines of one model of one run. */
  lines: readonly ResultLine[];
  /** That model's scored lines, from `scoreRun`. */
  scored: readonly ScoredLine[];
}>;

/** Each unit's outcome per criterion, counted as `scoreRun` counts its tallies. */
export const runOutcomes = ({ items, lines, scored }: OutcomesInput): RunOutcomes => {
  const byItem = new Map(items.map((item) => [item.id, item]));
  const byLine = new Map(
    scored.map((entry) => [unitKey(entry.line.item_id, entry.line.repeat), entry]),
  );
  const known = lines.filter((line) => byItem.has(line.item_id));

  const lineOutcome = (line: ResultLine, criterion: ScoredCriterion): UnitOutcome => {
    if (line.skipped !== null) return "skipped";
    const done = byLine.get(unitKey(line.item_id, line.repeat));
    if (done) return done.scores[criterion].score;
    const item = byItem.get(line.item_id);
    return item && applies(item, criterion) ? "error" : "na";
  };

  const consistencyOutcome = (itemId: string): UnitOutcome => {
    const item = byItem.get(itemId);
    const repeats = known.filter((line) => line.item_id === itemId);
    const counted = repeats.filter((line) => line.skipped === null);
    if (!item || counted.length === 0) return "skipped";
    if (!applies(item, "consistency") || item.repeat < 2) return "na";
    if (counted.some((line) => !isAnswered(line))) return "error";
    const first = scored.find((entry) => entry.item.id === itemId);
    return first?.scores.consistency.score ?? "error";
  };

  return new Map(
    SCORED_CRITERIA.map((criterion) => [
      criterion,
      criterion === "consistency"
        ? new Map(
            [...new Set(known.map((line) => line.item_id))].map((itemId) => [
              unitKey(itemId),
              consistencyOutcome(itemId),
            ]),
          )
        : new Map(
            known.map((line) => [
              unitKey(line.item_id, line.repeat),
              lineOutcome(line, criterion),
            ]),
          ),
    ]),
  );
};

/**
 * One outcome for an item from its repeats' outcomes on a criterion. Skipped
 * repeats do not count. Passes on more than half of the rest: pass. Too few
 * passes for a majority even if every undecided repeat (error, `human`)
 * passed: fail, so a tie counts as not passed. Otherwise the item stays
 * undecided, as `error` when a repeat errored and `human` when not.
 */
export const itemOutcome = (repeats: readonly UnitOutcome[]): UnitOutcome => {
  const counted = repeats.filter((outcome) => outcome !== "skipped");
  if (counted.length === 0) return "skipped";
  if (counted.every((outcome) => outcome === "na")) return "na";
  const n = counted.length;
  const passes = counted.filter((outcome) => outcome === "pass").length;
  const fails = counted.filter((outcome) => outcome === "fail").length;
  if (2 * passes > n) return "pass";
  if (2 * (n - fails) <= n) return "fail";
  if (counted.includes("error")) return "error";
  return counted.includes("human") ? "human" : "na";
};

const itemOf = (key: string): string => {
  const hash = key.lastIndexOf("#");
  return hash === -1 ? key : key.slice(0, hash);
};

/** Line outcomes folded into item outcomes; consistency, already per item, is kept. */
export const toItemOutcomes = (outcomes: RunOutcomes): RunOutcomes =>
  new Map(
    [...outcomes].map(([criterion, units]) => {
      if (criterion === "consistency") return [criterion, units] as const;
      const grouped = [...units].reduce((acc, [key, outcome]) => {
        const item = itemOf(key);
        return acc.set(item, [...(acc.get(item) ?? []), outcome]);
      }, new Map<string, UnitOutcome[]>());
      return [
        criterion,
        new Map([...grouped].map(([item, repeats]) => [item, itemOutcome(repeats)])),
      ] as const;
    }),
  );

/** Exact two-sided McNemar p-value from the two discordant counts. */
export const exactMcNemarP = (b: number, c: number): number => {
  if (![b, c].every((count) => Number.isInteger(count) && count >= 0)) {
    throw new RangeError("discordant counts must be whole numbers, 0 or more");
  }
  const n = b + c;
  if (n === 0) return 1;
  const low = Math.min(b, c);
  // Lower tail of Binomial(n, 1/2) up to `low`. Direct sums are exact for
  // the small n of an eval run; past 1000, 2^n leaves the double range, so
  // sum in log space instead.
  if (n <= 1000) {
    let term = 1;
    let sum = 1;
    for (let k = 0; k < low; k += 1) {
      term = (term * (n - k)) / (k + 1);
      sum += term;
    }
    return Math.min(1, (2 * sum) / 2 ** n);
  }
  let logTerm = -n * Math.LN2;
  let sum = Math.exp(logTerm);
  for (let k = 0; k < low; k += 1) {
    logTerm += Math.log(n - k) - Math.log(k + 1);
    sum += Math.exp(logTerm);
  }
  return Math.min(1, 2 * sum);
};

/** Holm-adjusted p-values, in the order given; null stays null and is not counted. */
export const holm = (values: readonly (number | null)[]): (number | null)[] => {
  const tested = values
    .map((p, index) => ({ p, index }))
    .filter((entry): entry is { p: number; index: number } => entry.p !== null)
    .sort((a, b) => a.p - b.p || a.index - b.index);
  const m = tested.length;
  const adjusted = new Map<number, number>();
  tested.reduce((running, entry, rank) => {
    const next = Math.max(running, Math.min(1, (m - rank) * entry.p));
    adjusted.set(entry.index, next);
    return next;
  }, 0);
  return values.map((_, index) => adjusted.get(index) ?? null);
};

export const EXCLUSION_REASONS = ["unpaired", "skipped", "error", "human", "na"] as const;

export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

export type CriterionComparison = Readonly<{
  criterion: ScoredCriterion;
  /** Units with pass or fail on both sides. */
  pairs: number;
  bothPass: number;
  /** A passed, B failed. */
  aOnly: number;
  /** B passed, A failed. */
  bOnly: number;
  bothFail: number;
  excluded: Readonly<Record<ExclusionReason, number>>;
  /** Null when there is no pair. */
  p: number | null;
  /** Holm across the criteria of this comparison. */
  pHolm: number | null;
  /** Holm across every comparison read together (`familyHolm`); equals `pHolm` alone. */
  pHolmFamily: number | null;
}>;

const reasonOf = (
  a: UnitOutcome | undefined,
  b: UnitOutcome | undefined,
): ExclusionReason | null => {
  if (a === undefined || b === undefined) return "unpaired";
  const sides = [a, b];
  return (
    (["skipped", "error", "human", "na"] as const).find((reason) =>
      sides.includes(reason),
    ) ?? null
  );
};

type Cell = ExclusionReason | "bothPass" | "aOnly" | "bOnly" | "bothFail";

const compareCriterion = (
  criterion: ScoredCriterion,
  a: ReadonlyMap<string, UnitOutcome>,
  b: ReadonlyMap<string, UnitOutcome>,
): Omit<CriterionComparison, "pHolm" | "pHolmFamily"> => {
  const classes = [...new Set([...a.keys(), ...b.keys()])].map((key): Cell => {
    const left = a.get(key);
    const right = b.get(key);
    const reason = reasonOf(left, right);
    if (reason !== null) return reason;
    if (left === "pass") return right === "pass" ? "bothPass" : "aOnly";
    return right === "pass" ? "bOnly" : "bothFail";
  });
  const count = (cell: Cell) => classes.filter((each) => each === cell).length;
  const excluded = Object.fromEntries(
    EXCLUSION_REASONS.map((reason) => [reason, count(reason)]),
  ) as Record<ExclusionReason, number>;
  const cells = {
    bothPass: count("bothPass"),
    aOnly: count("aOnly"),
    bOnly: count("bOnly"),
    bothFail: count("bothFail"),
  };
  const pairs = cells.bothPass + cells.aOnly + cells.bOnly + cells.bothFail;
  return {
    criterion,
    pairs,
    ...cells,
    excluded,
    p: pairs === 0 ? null : exactMcNemarP(cells.aOnly, cells.bOnly),
  };
};

/** Every scored criterion, A against B, with Holm's adjustment across them. */
export const compareRuns = (a: RunOutcomes, b: RunOutcomes): CriterionComparison[] => {
  const rows = SCORED_CRITERIA.map((criterion) =>
    compareCriterion(
      criterion,
      a.get(criterion) ?? new Map(),
      b.get(criterion) ?? new Map(),
    ),
  );
  const adjusted = holm(rows.map((row) => row.p));
  return rows.map((row, index) => {
    const pHolm = adjusted[index] ?? null;
    return { ...row, pHolm, pHolmFamily: pHolm };
  });
};

/** Holm across every criterion of every comparison given, kept in their shape. */
export const familyHolm = (
  comparisons: readonly (readonly CriterionComparison[])[],
): CriterionComparison[][] => {
  const adjusted = holm(comparisons.flatMap((rows) => rows.map((row) => row.p)));
  const offsets = comparisons.map((_, index) =>
    comparisons.slice(0, index).reduce((sum, rows) => sum + rows.length, 0),
  );
  return comparisons.map((rows, index) =>
    rows.map((row, at) => ({
      ...row,
      pHolmFamily: adjusted[(offsets[index] ?? 0) + at] ?? null,
    })),
  );
};

const formatP = (p: number | null): string =>
  p === null ? "—" : p < 0.0001 ? "< 0.0001" : p.toFixed(4);

const excludedText = (excluded: Readonly<Record<ExclusionReason, number>>): string => {
  const parts = EXCLUSION_REASONS.filter((reason) => excluded[reason] > 0).map(
    (reason) => `${excluded[reason]} ${reason}`,
  );
  return parts.length === 0 ? "none" : parts.join(", ");
};

/** A Markdown table of one comparison; the caller titles it. */
export const renderComparison = (rows: readonly CriterionComparison[]): string =>
  [
    "| Criterion | Pairs | A pass | B pass | Both pass | A only | B only | Both fail | p | p (Holm) | p (Holm, all) | Left out |",
    "| --- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --- |",
    ...rows.map(
      (row) =>
        `| ${[
          row.criterion,
          row.pairs,
          row.bothPass + row.aOnly,
          row.bothPass + row.bOnly,
          row.bothPass,
          row.aOnly,
          row.bOnly,
          row.bothFail,
          formatP(row.p),
          formatP(row.pHolm),
          formatP(row.pHolmFamily),
          excludedText(row.excluded),
        ].join(" | ")} |`,
    ),
  ].join("\n");
