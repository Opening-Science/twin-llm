/**
 * Cohort-level event rates from warehouse rows, for `cohort_event_rates`
 * (#293). Pure. The people and the designs are the heart-brain study's own
 * (`cohort.ts`, `within-person.ts`, `matched.ts`), so the tool and
 * `scripts/heart-brain` count events and person-time the same way.
 *
 * The warehouse keeps a birth year and a death year, never a date (#4). So a
 * person is born on 2 July of the birth year, and a person who died ends on
 * 2 July of the death year, or on their latest onset read here when that is
 * later, and never after 31 December of that year. The study reads the full
 * dates from the archives; this is the one place the two can differ, by up
 * to half a year of age and of follow-up per person.
 */
import { type Random } from "@/infrastructure/seeded-random";

import { CONDITION_CODES, type Topic, TOPICS, topicOf } from "./codes";
import { ageYears, dayNumber, historyStart, type Person } from "./cohort";
import { matchedIncidence } from "./matched";
import { type Interval, type Rate, type RateRatio } from "./poisson";
import { type Recovered, recoveredOf } from "./verdict";
import { AGE_BAND_YEARS, timingResult, timingTable } from "./within-person";

/**
 * One code per condition the study reads, its first in `codes.ts`; the tool
 * counts every code of that condition, so the other codes need no entry.
 */
export const EVENT_RATE_CODES = TOPICS.flatMap((topic) =>
  CONDITION_CODES[topic].slice(0, 1).map((entry) => entry.code),
) as [string, ...string[]];

/** The codes counted for one code: every code of its topic. */
export const topicCodes = (topic: Topic): string[] =>
  CONDITION_CODES[topic].map((entry) => entry.code);

export type CohortSetup = Readonly<{
  /** Synthea's end date (`-e`), YYYY-MM-DD: living people are followed to it. */
  endDay: string;
  /** Synthea's `exporter.years_of_history`; events count from that many years before the end. */
  historyYears: number;
  /** The one condition a subset cohort was selected on, or null for a whole batch. */
  selectedOn: Topic | null;
}>;

const BATCH: CohortSetup = { endDay: "2026-01-01", historyYears: 10, selectedOn: null };

/** The AF subset of the 1M batches (`scripts/heart-brain/af-subset.ts`). */
export const AF_SUBSET_COHORT = "synthea-v4-1m-af";

const BATCH_ID = /^synthea-v4-seed(10(0[1-9]|[1-9]\d)|1100)$/;

/**
 * Cohorts whose generator settings are known, so their follow-up window is:
 * the 1M batches (seeds 1001 to 1100, end 2026-01-01, 10 years of history)
 * and the AF subset of them. Null for any other cohort.
 */
export const cohortSetupOf = (cohortId: string): CohortSetup | null => {
  if (cohortId === AF_SUBSET_COHORT) return { ...BATCH, selectedOn: "af" };
  return BATCH_ID.test(cohortId) ? BATCH : null;
};

export type CohortSubjectRow = Readonly<{
  subjectRef: string;
  sex: string | null;
  birthYear: number | null;
  deathYear: number | null;
}>;

export type CohortConditionRow = Readonly<{
  subjectRef: string;
  code: string;
  onsetAt: Date;
}>;

const MID_YEAR = "-07-02";

const yearDay = (year: number, rest: string): number =>
  dayNumber(`${String(year).padStart(4, "0")}${rest}`);

const sexOf = (sex: string | null): Person["sex"] =>
  sex === "female" ? "F" : sex === "male" ? "M" : null;

export type WarehousePeople = Readonly<{
  people: readonly Person[];
  /** Subjects left out because no birth year is stored. */
  withoutBirthYear: number;
}>;

/**
 * People as the study's designs read them, ordered by subject_ref so a
 * seeded match draws the same controls every time. Each topic's onset is its
 * first dated record of any of the topic's codes.
 */
export const warehousePeople = (
  subjects: readonly CohortSubjectRow[],
  conditions: readonly CohortConditionRow[],
  setup: CohortSetup,
): WarehousePeople => {
  const onsets = new Map<string, Partial<Record<Topic, number>>>();
  for (const row of conditions) {
    const topic = topicOf(row.code);
    if (topic === null) continue;
    const day = Math.floor(row.onsetAt.getTime() / 86_400_000);
    const found = onsets.get(row.subjectRef) ?? {};
    const earlier = found[topic];
    onsets.set(row.subjectRef, {
      ...found,
      [topic]: earlier === undefined ? day : Math.min(earlier, day),
    });
  }
  const end = dayNumber(setup.endDay);
  const observedFrom = historyStart(setup.endDay, setup.historyYears);
  const sorted = [...subjects].sort((a, b) =>
    a.subjectRef < b.subjectRef ? -1 : a.subjectRef > b.subjectRef ? 1 : 0,
  );
  const people = sorted.flatMap((subject): Person[] => {
    if (subject.birthYear === null) return [];
    const onset = onsets.get(subject.subjectRef) ?? {};
    const latest = Math.max(...Object.values(onset), Number.NEGATIVE_INFINITY);
    const death =
      subject.deathYear === null
        ? null
        : Math.min(
            Math.max(yearDay(subject.deathYear, MID_YEAR), latest),
            yearDay(subject.deathYear, "-12-31"),
          );
    return [
      {
        id: subject.subjectRef,
        batch: "",
        sex: sexOf(subject.sex),
        birth: yearDay(subject.birthYear, MID_YEAR),
        end: death === null ? end : Math.min(death, end),
        observedFrom,
        died: subject.deathYear !== null,
        onset,
        anticoagulant: null,
      },
    ];
  });
  return { people, withoutBirthYear: subjects.length - people.length };
};

export type RateSummary = Readonly<{
  events: number;
  person_years: number;
  /** Events per 100 person-years; null with no person-time. */
  rate_per_100py: number | null;
  /** Exact Poisson 95% interval of the rate (Garwood); null with no person-time. */
  ci_per_100py: Interval | null;
}>;

export type RatioSummary = Readonly<{
  value: number;
  low: number;
  high: number;
  method: string;
}> | null;

const round = (value: number, decimals: number): number => {
  const factor = 10 ** decimals;
  return Math.sign(value) * (Math.round(Math.abs(value) * factor) / factor);
};

export const summariseRate = (rate: Rate): RateSummary => ({
  events: rate.events,
  person_years: round(rate.personYears, 1),
  rate_per_100py: rate.per100 === null ? null : round(rate.per100, 3),
  ci_per_100py:
    rate.ci === null
      ? null
      : { low: round(rate.ci.low, 3), high: round(rate.ci.high, 3) },
});

export const summariseRatio = (ratio: RateRatio, method: string): RatioSummary =>
  ratio === null
    ? null
    : {
        value: round(ratio.ratio, 2),
        low: round(ratio.ci.low, 2),
        high: round(ratio.ci.high, 2),
        method,
      };

export const EXACT_RATIO =
  "after over before, exact 95% interval (conditional binomial, Clopper-Pearson)";
export const AGE_ADJUSTED_RATIO =
  "after over before, Mantel-Haenszel over 5-year age bands, Greenland-Robins 95% interval";
export const MATCHED_RATIO =
  "exposed over matched controls, 95% Wald interval on the log scale";

export type EventRateSpec = Readonly<{
  exposure: Topic;
  outcome: Topic;
  /** Counted time (within) or exposure onset (between) from this age. */
  minAge: number;
}>;

export type WithinRates = Readonly<{
  design: "within";
  /** People with the exposure and counted time. */
  people: number;
  /** People with the exposure left out because the outcome came before counted time. */
  outcome_before_follow_up: number;
  before_onset: RateSummary;
  after_onset: RateSummary;
  rate_ratio: RatioSummary;
  age_adjusted_rate_ratio: RatioSummary;
  verdict: Recovered;
  verdict_basis: string;
}>;

/** The same people before and after their own exposure onset (`within-person.ts`). */
export const withinRates = (
  people: readonly Person[],
  spec: EventRateSpec,
): WithinRates => {
  const timingSpec = {
    exposure: spec.exposure,
    outcome: spec.outcome,
    minAgeYears: spec.minAge,
    afterWindowsYears: [0],
    ageBandYears: AGE_BAND_YEARS,
  };
  const result = timingResult(timingTable(people, timingSpec), timingSpec);
  return {
    design: "within",
    people: result.people,
    outcome_before_follow_up: result.outcomeBefore,
    before_onset: summariseRate(result.before),
    after_onset: summariseRate(result.after.rate),
    rate_ratio: summariseRatio(result.after.crude, EXACT_RATIO),
    age_adjusted_rate_ratio: summariseRatio(result.after.ageAdjusted, AGE_ADJUSTED_RATIO),
    verdict: recoveredOf(result.after.ageAdjusted),
    verdict_basis:
      "the age-adjusted ratio's 95% interval against 1: raised above 1, lowered below 1, no clear difference when it covers 1, too few events when there is no ratio",
  };
};

export const CONTROLS_PER_EXPOSED = 4;
export const MATCH_SEED = 250;

export type BetweenRates = Readonly<{
  design: "between";
  exposed_people: number;
  control_people: number;
  /** Exposed people for whom fewer than 4 controls were found. */
  short_of_controls: number;
  exposed: RateSummary;
  matched_controls: RateSummary;
  rate_ratio: RatioSummary;
  verdict: Recovered;
  verdict_basis: string;
}>;

/** Exposed people against age- and sex-matched people without the exposure (`matched.ts`). */
export const betweenRates = (
  people: readonly Person[],
  spec: EventRateSpec,
  random: Random,
): BetweenRates => {
  const result = matchedIncidence(
    people,
    {
      exposure: spec.exposure,
      outcome: spec.outcome,
      controlsPerExposed: CONTROLS_PER_EXPOSED,
      ...(spec.minAge === 0
        ? {}
        : {
            keepExposed: (person: Person) =>
              ageYears(person, person.onset[spec.exposure] ?? person.end) >= spec.minAge,
          }),
    },
    random,
  );
  return {
    design: "between",
    exposed_people: result.exposedPeople,
    control_people: result.controlPeople,
    short_of_controls: result.shortOfControls,
    exposed: summariseRate(result.exposed),
    matched_controls: summariseRate(result.controls),
    rate_ratio: summariseRatio(result.ratio, MATCHED_RATIO),
    verdict: recoveredOf(result.ratio),
    verdict_basis:
      "the rate ratio's 95% interval against 1: raised above 1, lowered below 1, no clear difference when it covers 1, too few events when there is no ratio",
  };
};
