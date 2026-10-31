import { describe, expect, test } from "bun:test";

import type { AppendInput } from "@/packages/audit/append";

import {
  type CohortConditionRow,
  type CohortSubjectRow,
} from "./event-rates/cohort-rates";
import type { QueryToolPorts } from "./ports";
import { type SessionScope } from "./scope";
import { QUERY_TOOL_FAILED, runCohortEventRates } from "./tools";

/**
 * `cohort_event_rates` over hand-made warehouse rows (the cohort of
 * `event-rates/cohort-rates.test.ts`, where the numbers are worked out).
 * Every expected value is written out.
 */

const BATCH = "synthea-v4-seed1001";
const AF_ONLY = "synthea-v4-1m-af";
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

const SUBJECTS: readonly CohortSubjectRow[] = [
  subject("a"),
  subject("b"),
  subject("c"),
  subject("d"),
  subject("e"),
  { subjectRef: "f", sex: "female", birthYear: null, deathYear: null },
];

const CONDITIONS: readonly CohortConditionRow[] = [
  onset("a", AF, "2017-01-01"),
  onset("a", STROKE, "2018-01-01"),
  onset("b", AF, "2017-01-01"),
  onset("b", STROKE, "2016-07-01"),
  onset("c", AF, "2018-01-01"),
  onset("d", AF, "2017-01-01"),
  onset("d", STROKE, "2015-06-01"),
  onset("e", STROKE, "2017-03-01"),
];

const fakePorts = (
  subjects: readonly CohortSubjectRow[] = SUBJECTS,
  conditions: readonly CohortConditionRow[] = CONDITIONS,
) => {
  const audits: AppendInput[] = [];
  const reads: unknown[] = [];
  const ports: QueryToolPorts = {
    findSubject: async () => null,
    findObservations: async () => [],
    findCohortObservations: async () => [],
    findCohortSubjects: async (query) => {
      reads.push(["subjects", query]);
      return subjects.slice(0, query.take);
    },
    findCohortConditions: async (query) => {
      reads.push(["conditions", query]);
      return conditions
        .filter((row) => query.codes.includes(row.code))
        .slice(0, query.take);
    },
    findLoadedCohorts: async (ids) => ids.filter((id) => id === BATCH || id === AF_ONLY),
    appendAudit: async (input) => {
      audits.push(input);
    },
  };
  return { ports, audits, reads };
};

const synthetic: SessionScope = { actor: "local", sessionId: "turn", mode: "synthetic" };
const personal: SessionScope = { actor: "local", sessionId: "turn", mode: "personal" };

const INPUT = {
  cohort_id: BATCH,
  exposure_code: AF,
  outcome_code: STROKE,
  design: "within",
} as const;

const NOTE =
  "Rates in this loaded synthetic Synthea cohort only, made by the generator's rules; not about people in general and not a cause. Ages use 2 July of the stored birth year and follow-up of a person who died ends mid death year, because the warehouse stores years only.";

describe("cohort_event_rates", () => {
  test("within: AF then stroke, exact output, audited with the rows read", async () => {
    const { ports, audits, reads } = fakePorts();
    const result = await runCohortEventRates(synthetic, INPUT, ports);
    expect(result).toEqual({
      cohort_id: BATCH,
      exposure: { code: AF, display: "Atrial fibrillation", codes: [AF] },
      outcome: { code: STROKE, display: "Cerebrovascular accident", codes: [STROKE] },
      min_age: 0,
      follow_up: { from: "2016-01-01", to: "2026-01-01" },
      subjects_read: 6,
      subjects_without_birth_year: 1,
      conditions_read: 8,
      rows_read: 14,
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
      note: NOTE,
    });
    expect(reads).toEqual([
      ["subjects", { cohortId: BATCH, take: 50_001 }],
      ["conditions", { cohortId: BATCH, codes: [AF, STROKE], take: 50_001 }],
    ]);
    expect(audits).toEqual([
      {
        actor: "local",
        sessionId: "turn",
        subjectRef: null,
        tool: "cohort_event_rates",
        args: INPUT,
        result,
        rowCount: 14,
      },
    ]);
  });

  test("the output holds no subject_ref, date of a person or value", async () => {
    const { ports } = fakePorts();
    const text = JSON.stringify(await runCohortEventRates(synthetic, INPUT, ports));
    for (const ref of ['"a"', '"b"', '"c"', '"d"', '"e"', '"f"', "2017-01-01", "1950"]) {
      expect(text.includes(ref)).toBe(false);
    }
  });

  test("between on a whole batch is matched, with the seeded draw", async () => {
    // Exposed: a (365 days to its stroke) and c (547 days to its death), 912
    // days. On a's onset the eligible controls are c (until its own AF, 365
    // days) and e (59 days to its stroke); the seeded draw takes e three times
    // and c once: 3 strokes in 542 days. Nobody is eligible on c's onset.
    const { ports } = fakePorts();
    const result = await runCohortEventRates(
      synthetic,
      { ...INPUT, design: "between", min_age: 60 },
      ports,
    );
    expect(result).toMatchObject({
      design: "between",
      min_age: 60,
      exposed_people: 2,
      control_people: 4,
      short_of_controls: 1,
      exposed: { events: 1, person_years: 2.5, rate_per_100py: 40.049 },
      matched_controls: { events: 3, person_years: 1.5, rate_per_100py: 202.168 },
      rate_ratio: {
        value: 0.2,
        low: 0.02,
        high: 1.9,
        method: "exposed over matched controls, 95% Wald interval on the log scale",
      },
      verdict: "no clear difference",
    });
  });

  test("personal mode is refused before any read and audited with 0 rows", async () => {
    const { ports, audits, reads } = fakePorts();
    expect(await runCohortEventRates(personal, INPUT, ports)).toEqual({
      code: "SUBJECT_SCOPE_VIOLATION",
      error: "no cohort can be read in personal mode",
      cohorts: [],
    });
    expect(reads).toEqual([]);
    expect(audits.map((audit) => [audit.tool, audit.subjectRef, audit.rowCount])).toEqual(
      [["cohort_event_rates", null, 0]],
    );
  });

  test("a cohort off the allowlist is refused and names the loaded ones", async () => {
    const { ports, reads } = fakePorts();
    expect(
      await runCohortEventRates(
        synthetic,
        { ...INPUT, cohort_id: "synthetic-cohort-001" },
        ports,
      ),
    ).toEqual({
      code: "SUBJECT_SCOPE_VIOLATION",
      error: "cohort_id is not a cohort this session can read; use one listed in cohorts",
      cohorts: [AF_ONLY, BATCH],
    });
    expect(reads).toEqual([]);
  });

  test("an allowlisted cohort with no known follow-up is COHORT_NOT_SUPPORTED", async () => {
    const { ports, audits } = fakePorts();
    expect(
      await runCohortEventRates(
        synthetic,
        { ...INPUT, cohort_id: "synthea-v4-seed42" },
        ports,
      ),
    ).toEqual({
      code: "COHORT_NOT_SUPPORTED",
      error:
        "cohort_event_rates knows the follow-up window of the 1M Synthea batches and their AF subset only; use one listed in cohorts",
      cohort_id: "synthea-v4-seed42",
      cohorts: [AF_ONLY, BATCH],
    });
    expect(audits.map((audit) => audit.rowCount)).toEqual([0]);
  });

  test("the AF subset refuses between and another exposure", async () => {
    const { ports, reads } = fakePorts();
    const refusal = {
      code: "DESIGN_NOT_SUPPORTED",
      error:
        "this cohort holds only people with condition 49436004, so it supports the within design with 49436004 as the exposure only",
      cohort_id: AF_ONLY,
      selected_on: AF,
    };
    expect(
      await runCohortEventRates(
        synthetic,
        { ...INPUT, cohort_id: AF_ONLY, design: "between" },
        ports,
      ),
    ).toEqual(refusal);
    expect(
      await runCohortEventRates(
        synthetic,
        { ...INPUT, cohort_id: AF_ONLY, exposure_code: "44054006" },
        ports,
      ),
    ).toEqual(refusal);
    expect(reads).toEqual([]);
  });

  test("the AF subset answers the within design with AF as the exposure", async () => {
    const { ports } = fakePorts();
    const result = await runCohortEventRates(
      synthetic,
      { ...INPUT, cohort_id: AF_ONLY, outcome_code: "26929004" },
      ports,
    );
    expect(result).toMatchObject({
      cohort_id: AF_ONLY,
      outcome: { code: "26929004", codes: ["26929004", "230265002"] },
      people: 4,
      before_onset: { events: 0 },
      after_onset: { events: 0 },
      rate_ratio: null,
      verdict: "too few events",
    });
  });

  test("more than 50000 subjects or conditions is refused, not cut", async () => {
    const many = Array.from({ length: 50_001 }, (_, index) => subject(`s${index}`));
    const { ports, audits } = fakePorts(many);
    expect(await runCohortEventRates(synthetic, INPUT, ports)).toEqual({
      code: "COHORT_RECORD_CAP_EXCEEDED",
      error: "more than 50000 subject records in this cohort for this question",
      record: "subject",
      cap: 50_000,
    });
    const rows = Array.from({ length: 50_001 }, () => onset("a", AF, "2017-01-01"));
    const second = fakePorts(SUBJECTS, rows);
    expect(await runCohortEventRates(synthetic, INPUT, second.ports)).toMatchObject({
      code: "COHORT_RECORD_CAP_EXCEEDED",
      record: "condition",
    });
    expect(audits.map((audit) => audit.rowCount)).toEqual([0]);
  });

  test("a read that throws is still audited with 0 rows and no message", async () => {
    const { ports: base, audits } = fakePorts();
    const ports: QueryToolPorts = {
      ...base,
      findCohortSubjects: () => Promise.reject(new Error("synthetic database down")),
    };
    await expect(runCohortEventRates(synthetic, INPUT, ports)).rejects.toThrow(
      "synthetic database down",
    );
    expect(audits.map((audit) => [audit.result, audit.rowCount])).toEqual([
      [QUERY_TOOL_FAILED, 0],
    ]);
  });
});
