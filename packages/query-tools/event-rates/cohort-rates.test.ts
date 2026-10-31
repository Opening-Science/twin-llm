import { describe, expect, test } from "bun:test";

import { dayNumber } from "./cohort";
import {
  AF_SUBSET_COHORT,
  betweenRates,
  cohortSetupOf,
  EVENT_RATE_CODES,
  summariseRate,
  summariseRatio,
  topicCodes,
  warehousePeople,
  withinRates,
} from "./cohort-rates";

/**
 * Hand-made warehouse rows. Everyone is born in 1950 (so 2 July 1950) and
 * counted from 2016-01-01; those who died in 2019 end on 2019-07-02, so all
 * counted time lies in the 65 to 70 age band and the age-adjusted ratio
 * equals the crude one.
 */
const SETUP = { endDay: "2026-01-01", historyYears: 10, selectedOn: null };
const AF = "49436004";
const STROKE = "230690007";

const subject = (subjectRef: string, deathYear: number | null = 2019) => ({
  subjectRef,
  sex: "male",
  birthYear: 1950,
  deathYear,
});

const onset = (subjectRef: string, code: string, day: string) => ({
  subjectRef,
  code,
  onsetAt: new Date(`${day}T10:00:00.000Z`),
});

const SUBJECTS = [
  subject("a"),
  subject("b"),
  subject("c"),
  subject("d"),
  subject("e"),
  { subjectRef: "f", sex: "female", birthYear: null, deathYear: null },
];

const CONDITIONS = [
  onset("a", AF, "2017-01-01"),
  onset("a", STROKE, "2018-01-01"),
  onset("b", AF, "2017-01-01"),
  onset("b", STROKE, "2016-07-01"),
  onset("c", AF, "2018-01-01"),
  onset("d", AF, "2017-01-01"),
  onset("d", STROKE, "2015-06-01"),
  onset("e", STROKE, "2017-03-01"),
];

describe("cohortSetupOf", () => {
  test("knows the 1M batches and the AF subset, nothing else", () => {
    expect(cohortSetupOf("synthea-v4-seed1001")).toEqual(SETUP);
    expect(cohortSetupOf("synthea-v4-seed1100")).toEqual(SETUP);
    expect(cohortSetupOf(AF_SUBSET_COHORT)).toEqual({ ...SETUP, selectedOn: "af" });
    expect(cohortSetupOf("synthea-v4-seed1000")).toBeNull();
    expect(cohortSetupOf("synthea-v4-seed1101")).toBeNull();
    expect(cohortSetupOf("synthea-v4-seed42")).toBeNull();
  });
});

describe("codes", () => {
  test("one code per condition, and a condition's codes together", () => {
    expect(EVENT_RATE_CODES).toEqual([
      AF,
      STROKE,
      "88805009",
      "59621000",
      "44054006",
      "22298006",
      "414545008",
      "26929004",
      "78275009",
      "132281000119108",
    ]);
    expect(topicCodes("dementia")).toEqual(["26929004", "230265002"]);
  });
});

describe("warehousePeople", () => {
  test("mid-year birth, mid-year death, first onset per topic, sorted", () => {
    const { people, withoutBirthYear } = warehousePeople(
      [subject("z", null), subject("y", 2019)],
      [
        onset("y", STROKE, "2019-10-01"),
        onset("y", AF, "2012-05-05"),
        onset("y", AF, "2010-03-03"),
        onset("z", "26929004", "2021-01-01"),
        onset("z", "999999", "2020-01-01"),
      ],
      SETUP,
    );
    expect(withoutBirthYear).toBe(0);
    expect(people).toEqual([
      {
        id: "y",
        batch: "",
        sex: "M",
        birth: dayNumber("1950-07-02"),
        end: dayNumber("2019-10-01"),
        observedFrom: dayNumber("2016-01-01"),
        died: true,
        onset: { af: dayNumber("2010-03-03"), stroke: dayNumber("2019-10-01") },
        anticoagulant: null,
      },
      {
        id: "z",
        batch: "",
        sex: "M",
        birth: dayNumber("1950-07-02"),
        end: dayNumber("2026-01-01"),
        observedFrom: dayNumber("2016-01-01"),
        died: false,
        onset: { dementia: dayNumber("2021-01-01") },
        anticoagulant: null,
      },
    ]);
  });

  test("a death ends no later than 31 December of the death year", () => {
    const { people } = warehousePeople(
      [subject("y", 2019)],
      [onset("y", STROKE, "2020-02-01")],
      SETUP,
    );
    expect(people[0]?.end).toBe(dayNumber("2019-12-31"));
  });

  test("no birth year leaves the subject out and counts it", () => {
    const { people, withoutBirthYear } = warehousePeople(SUBJECTS, CONDITIONS, SETUP);
    expect(people.map((person) => person.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(withoutBirthYear).toBe(1);
  });
});

describe("summarise", () => {
  test("rounds person-years to 0.1, rates to 0.001 and ratios to 0.01", () => {
    expect(
      summariseRate({
        events: 3,
        personYears: 12.345,
        per100: 24.30134,
        ci: { low: 5.01149, high: 71.0151 },
      }),
    ).toEqual({
      events: 3,
      person_years: 12.3,
      rate_per_100py: 24.301,
      ci_per_100py: { low: 5.011, high: 71.015 },
    });
    expect(summariseRate({ events: 0, personYears: 0, per100: null, ci: null })).toEqual({
      events: 0,
      person_years: 0,
      rate_per_100py: null,
      ci_per_100py: null,
    });
    expect(
      summariseRatio({ ratio: 3.0951, ci: { low: 2.065, high: 4.6349 } }, "m"),
    ).toEqual({ value: 3.1, low: 2.07, high: 4.63, method: "m" });
    expect(summariseRatio(null, "m")).toBeNull();
  });
});

describe("withinRates", () => {
  const { people } = warehousePeople(SUBJECTS, CONDITIONS, SETUP);

  test("AF then stroke in the hand-made cohort", () => {
    // Before: a 366 days, b 182 days with its stroke, c 731 days = 1279 days.
    // After: a 365 days with its stroke, c 547 days = 912 days.
    // Crude ratio 1279 / 912 = 1.4024; exact interval from Clopper-Pearson with
    // 1 of 2 events: p from 1 - sqrt(0.975) to sqrt(0.975).
    expect(withinRates(people, { exposure: "af", outcome: "stroke", minAge: 0 })).toEqual(
      {
        design: "within",
        people: 3,
        outcome_before_follow_up: 1,
        before_onset: {
          events: 1,
          person_years: 3.5,
          rate_per_100py: 28.557,
          ci_per_100py: { low: 0.723, high: 159.112 },
        },
        after_onset: {
          events: 1,
          person_years: 2.5,
          rate_per_100py: 40.049,
          ci_per_100py: { low: 1.014, high: 223.141 },
        },
        rate_ratio: {
          value: 1.4,
          low: 0.02,
          high: 110.08,
          method:
            "after over before, exact 95% interval (conditional binomial, Clopper-Pearson)",
        },
        age_adjusted_rate_ratio: {
          value: 1.4,
          low: 0.09,
          high: 22.42,
          method:
            "after over before, Mantel-Haenszel over 5-year age bands, Greenland-Robins 95% interval",
        },
        verdict: "no clear difference",
        verdict_basis:
          "the age-adjusted ratio's 95% interval against 1: raised above 1, lowered below 1, no clear difference when it covers 1, too few events when there is no ratio",
      },
    );
  });

  test("an age floor past everyone's follow-up leaves too few events", () => {
    const result = withinRates(people, { exposure: "af", outcome: "stroke", minAge: 75 });
    expect([result.people, result.verdict, result.rate_ratio]).toEqual([
      0,
      "too few events",
      null,
    ]);
  });
});

describe("betweenRates", () => {
  // x has AF from 2017 and a stroke a year later; y, the only other man born
  // in 1950, never has AF and has a stroke on 2020-01-01. Every draw that
  // fits is y, so y is drawn 4 times: 4 strokes in 4 x 1095 days.
  const { people } = warehousePeople(
    [subject("x", null), subject("y", null)],
    [
      onset("x", AF, "2017-01-01"),
      onset("x", STROKE, "2018-01-01"),
      onset("y", STROKE, "2020-01-01"),
    ],
    SETUP,
  );
  const random = () => 0.75;

  test("exposed against four matched controls", () => {
    expect(
      betweenRates(people, { exposure: "af", outcome: "stroke", minAge: 0 }, random),
    ).toEqual({
      design: "between",
      exposed_people: 1,
      control_people: 4,
      short_of_controls: 0,
      exposed: {
        events: 1,
        person_years: 1,
        rate_per_100py: 100.068,
        ci_per_100py: { low: 2.534, high: 557.546 },
      },
      matched_controls: {
        events: 4,
        person_years: 12,
        rate_per_100py: 33.356,
        ci_per_100py: { low: 9.088, high: 85.405 },
      },
      rate_ratio: {
        value: 3,
        low: 0.34,
        high: 26.84,
        method: "exposed over matched controls, 95% Wald interval on the log scale",
      },
      verdict: "no clear difference",
      verdict_basis:
        "the rate ratio's 95% interval against 1: raised above 1, lowered below 1, no clear difference when it covers 1, too few events when there is no ratio",
    });
  });

  test("an age floor above the exposure onset keeps no exposed person", () => {
    const result = betweenRates(
      people,
      { exposure: "af", outcome: "stroke", minAge: 70 },
      random,
    );
    expect([result.exposed_people, result.verdict]).toEqual([0, "too few events"]);
  });
});
