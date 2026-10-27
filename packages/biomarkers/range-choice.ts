/**
 * Which published range applies to a marker, and where a value sits against it.
 * The Biomarkers tab and the `range_position` query tool both call these, so a
 * value reads the same in the body twin and in chat.
 *
 * Nothing is guessed. A range that needs a fact the context does not hold
 * (sex, age, or timing such as fasting, time of day or cycle phase) is not
 * chosen; `rangeChoice` names the missing facts instead.
 */
import { anchorLayer, type AnchorLayer, type ReferenceInterval } from "./anchor-layer";
import { referenceIntervalFor, referenceIntervalsOf } from "./catalogue";
import { intervalPosition, type IntervalPosition } from "./interval-position";
import { parsePopulation, type Population, type PopulationContext } from "./population";

/** Facts a published range can depend on. */
export const RANGE_FACTS = ["sex", "age", "timing"] as const;

export type RangeFact = (typeof RANGE_FACTS)[number];

export type RangeChoice =
  | Readonly<{ kind: "range"; interval: ReferenceInterval }>
  | Readonly<{ kind: "depends"; on: readonly RangeFact[] }>
  | Readonly<{ kind: "none" }>;

/** True when the population asks for this fact and the context does not hold it. */
const lacks = (
  population: Population,
  context: PopulationContext,
  fact: RangeFact,
): boolean => {
  if (fact === "sex") return population.sex !== null && context.sex === undefined;
  if (fact === "age") return population.age !== null && context.ageYears === undefined;
  return (
    population.qualifier !== null &&
    !(context.qualifiers ?? []).includes(population.qualifier)
  );
};

/**
 * The facts some of these intervals ask for and the context does not hold, in
 * `RANGE_FACTS` order. Empty when no single interval fits for another reason
 * (several fit, or a population Anchor wrote that this code cannot read).
 */
export const missingFacts = (
  intervals: readonly ReferenceInterval[],
  context: PopulationContext,
): readonly RangeFact[] => {
  const populations = intervals
    .map((interval) => parsePopulation(interval.population))
    .filter((population): population is Population => population !== null);
  return RANGE_FACTS.filter((fact) =>
    populations.some((population) => lacks(population, context, fact)),
  );
};

/** The one published range for this subject, what it depends on, or none at all. */
export const rangeChoice = (
  markerId: string,
  context: PopulationContext = {},
  layer: AnchorLayer = anchorLayer,
): RangeChoice => {
  const interval = referenceIntervalFor(markerId, context, layer);
  if (interval) return { kind: "range", interval };
  const intervals = referenceIntervalsOf(markerId, layer);
  if (intervals.length === 0) return { kind: "none" };
  return { kind: "depends", on: missingFacts(intervals, context) };
};

export type ValuePlacement =
  | Readonly<{ kind: "position"; position: Exclude<IntervalPosition, "unknown"> }>
  | Readonly<{ kind: "unit-mismatch"; unit: string; rangeUnit: string }>
  | Readonly<{ kind: "none" }>;

/**
 * Where a value sits against the chosen interval (`intervalPosition`), or why
 * it has no position: another unit than the range's, compared exactly and
 * never converted, or no position at all (no interval, D11, no bounds).
 */
export const placeValue = (
  value: number,
  unit: string,
  interval: ReferenceInterval | null,
): ValuePlacement => {
  const position = intervalPosition(value, unit, interval);
  if (position !== "unknown") return { kind: "position", position };
  if (interval?.unitUcum && interval.unitUcum !== unit) {
    return { kind: "unit-mismatch", unit, rangeUnit: interval.unitUcum };
  }
  return { kind: "none" };
};
