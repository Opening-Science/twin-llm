/**
 * The within-person timing study (#262): AF onset against stroke in the same
 * people, from all ages and from age 55, as a within-person cohort and as a
 * self-controlled case series, each repeated with shuffled AF onsets as the
 * negative control. Pure apart from the seeded random.
 */
import { randomFor } from "../synthetic-wearables/random";

import { type Person } from "./cohort";
import { shuffleAfOnsets, type Spread, spreadOf } from "./permutation";
import { type SccsResult, selfControlledCaseSeries } from "./sccs";
import {
  AGE_BAND_YEARS,
  DEFAULT_AFTER_WINDOWS,
  type TimingResult,
  timingResult,
  type TimingSpec,
  timingTable,
} from "./within-person";

export type TimingOptions = Readonly<{ seed: number; permutations: number }>;

export type TimingArm = Readonly<{
  minAgeYears: number;
  withinPerson: TimingResult;
  /** One window: all time after onset against before. */
  sccsOverall: SccsResult;
  sccsWindows: SccsResult;
  shuffled: Readonly<{
    withinCrude: Spread | null;
    withinAgeAdjusted: Spread | null;
    sccsOverall: Spread | null;
  }>;
  /** Share of shuffles at or above the observed value (with the observed one counted). */
  shuffledAtLeastObserved: Readonly<{
    withinAgeAdjusted: number | null;
    sccsOverall: number | null;
  }>;
}>;

export type TimingStudy = Readonly<{
  options: TimingOptions;
  arms: readonly TimingArm[];
}>;

export const MIN_AGES = [0, 55] as const;

export const specFor = (
  minAgeYears: number,
  afterWindowsYears: readonly number[],
): TimingSpec => ({
  exposure: "af",
  outcome: "stroke",
  minAgeYears,
  afterWindowsYears,
  ageBandYears: AGE_BAND_YEARS,
});

/** (1 + shuffles at or above observed) / (1 + shuffles), the usual permutation p. */
export const permutationShare = (
  observed: number | null,
  shuffled: readonly (number | null)[],
): number | null => {
  if (observed === null) return null;
  const values = shuffled.filter((value): value is number => value !== null);
  if (values.length === 0) return null;
  return (1 + values.filter((value) => value >= observed).length) / (1 + values.length);
};

const overallRatio = (result: SccsResult): number | null =>
  result.windows[0]?.ratio?.ratio ?? null;

const arm = (
  people: readonly Person[],
  minAgeYears: number,
  options: TimingOptions,
): TimingArm => {
  const windows = specFor(minAgeYears, DEFAULT_AFTER_WINDOWS);
  const overall = specFor(minAgeYears, [0]);
  const withinPerson = timingResult(timingTable(people, windows), windows);
  const sccsOverall = selfControlledCaseSeries(people, overall);
  const runs = Array.from({ length: options.permutations }, (_, run) => {
    const shuffled = shuffleAfOnsets(
      people,
      randomFor(options.seed, `timing-shuffle:${run}`),
    );
    const within = timingResult(timingTable(shuffled, overall), overall);
    return {
      crude: within.after.crude?.ratio ?? null,
      ageAdjusted: within.after.ageAdjusted?.ratio ?? null,
      sccs: overallRatio(selfControlledCaseSeries(shuffled, overall)),
    };
  });
  return {
    minAgeYears,
    withinPerson,
    sccsOverall,
    sccsWindows: selfControlledCaseSeries(people, windows),
    shuffled: {
      withinCrude: spreadOf(runs.map((run) => run.crude)),
      withinAgeAdjusted: spreadOf(runs.map((run) => run.ageAdjusted)),
      sccsOverall: spreadOf(runs.map((run) => run.sccs)),
    },
    shuffledAtLeastObserved: {
      withinAgeAdjusted: permutationShare(
        withinPerson.after.ageAdjusted?.ratio ?? null,
        runs.map((run) => run.ageAdjusted),
      ),
      sccsOverall: permutationShare(
        overallRatio(sccsOverall),
        runs.map((run) => run.sccs),
      ),
    },
  };
};

export const runTiming = (
  people: readonly Person[],
  options: TimingOptions,
): TimingStudy => {
  // Only people with AF take part; dropping the rest first keeps shuffles fast.
  const withAf = people.filter((person) => person.onset.af !== undefined);
  return { options, arms: MIN_AGES.map((age) => arm(withAf, age, options)) };
};
