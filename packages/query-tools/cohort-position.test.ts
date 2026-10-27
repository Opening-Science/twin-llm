import { describe, expect, test } from "bun:test";

import type { AppendInput } from "@/packages/audit/append";

import type {
  CohortObservationQuery,
  CohortObservationRecord,
  QueryToolPorts,
  SubjectScopeRow,
} from "./ports";
import {
  COHORT_ROW_CAP_EXCEEDED,
  cohortTooSmall,
  mixedUnits,
  noRows,
} from "./refusals";
import { cohortPositionInput } from "./schemas";
import { SUBJECT_SCOPE_VIOLATION, type SessionScope } from "./scope";
import { latestPerSubject, midRankPercentile } from "./stats";
import { QUERY_TOOL_FAILED, runCohortPosition } from "./tools";

/**
 * `cohort_position` over a synthetic cohort of eleven people. Every expected
 * value is written out and computed by hand, never by calling the code under
 * test.
 */

const COHORT = "synthea-v4-seed42";
const SUBJECT = "synthetic-cohort-position-subject";
const UNLISTED = "unlisted-cohort-subject";
const NOT_SYNTHETIC = "not-synthetic-subject";
const ELSEWHERE = "other-cohort-subject";
const HR = "8867-4";

const PEERS = ["p01", "p02", "p03", "p04", "p05", "p06", "p07", "p08", "p09", "p10"];

const SUBJECTS: Readonly<Record<string, SubjectScopeRow>> = {
  [SUBJECT]: { isSynthetic: true, cohortId: COHORT },
  ...Object.fromEntries(PEERS.map((peer) => [peer, { isSynthetic: true, cohortId: COHORT }])),
  [UNLISTED]: { isSynthetic: true, cohortId: "synthea-unlisted" },
  [NOT_SYNTHETIC]: { isSynthetic: false, cohortId: COHORT },
  [ELSEWHERE]: { isSynthetic: true, cohortId: "open-twin-synthea-trimmed-3" },
};

const JAN = { start: "2024-01-01", end: "2024-01-31" };
const MAR = { start: "2024-03-01", end: "2024-03-31" };

const T0 = Date.parse("2024-01-01T08:00:00.000Z");
const DAY = 86_400_000;

const row = (
  subjectRef: string,
  day: number,
  value: number,
  unitUcum = "/min",
  id = `${subjectRef}-${day}`,
): CohortObservationRecord => ({
  id,
  subjectRef,
  loinc: HR,
  value,
  unitUcum,
  effectiveAt: new Date(T0 + day * DAY),
});

/**
 * Synthetic heart rate in January 2024. The subject's latest is 70 (day 5);
 * its 90 on day 1 is older and its 50 on day 40 is outside the window. p01's
 * latest is 60 (its 100 on day 0 is older). Other cohorts and non-synthetic
 * rows are never compared.
 */
const FIXTURE: readonly CohortObservationRecord[] = [
  row(SUBJECT, 1, 90),
  row(SUBJECT, 5, 70),
  row(SUBJECT, 40, 50),
  row("p01", 0, 100),
  row("p01", 3, 60),
  row("p02", 2, 62),
  row("p03", 4, 65),
  row("p04", 6, 70),
  row("p05", 7, 74),
  row("p06", 8, 78),
  row("p07", 9, 80),
  row("p08", 10, 84),
  row("p09", 11, 88),
  row("p10", 12, 95),
  row(NOT_SYNTHETIC, 4, 40),
  row(ELSEWHERE, 4, 41),
];

const fakePorts = (rows: readonly CohortObservationRecord[] = FIXTURE) => {
  const audits: AppendInput[] = [];
  const queries: CohortObservationQuery[] = [];
  const ports: QueryToolPorts = {
    findSubject: async (subjectRef) => SUBJECTS[subjectRef] ?? null,
    findObservations: async () => {
      throw new Error("cohort_position reads the cohort, not one subject");
    },
    findCohortObservations: async (query) => {
      queries.push(query);
      return rows
        .filter((candidate) => {
          const subject = SUBJECTS[candidate.subjectRef];
          return (
            subject !== undefined &&
            subject.isSynthetic &&
            subject.cohortId === query.cohortId &&
            candidate.loinc === query.loinc &&
            candidate.effectiveAt.getTime() >= query.start.getTime() &&
            candidate.effectiveAt.getTime() <= query.end.getTime()
          );
        })
        .sort((a, b) => a.effectiveAt.getTime() - b.effectiveAt.getTime())
        .slice(0, query.take);
    },
    appendAudit: async (input) => {
      audits.push(input);
    },
  };
  return { ports, audits, queries };
};

const synthetic: SessionScope = { actor: "local", sessionId: "turn", mode: "synthetic" };
const personal: SessionScope = { actor: "local", sessionId: "turn", mode: "personal" };

const INPUT = { subject_ref: SUBJECT, loinc: HR, ...JAN };

describe("midRankPercentile", () => {
  test("ties count half: 5 among 1, 3, 5, 5, 7, 9, 9, 9, 10, 12", () => {
    // 2 lower, 2 equal, 6 higher: 100 × (2 + 2 / 2) / 10 = 30.
    expect(midRankPercentile(5, [1, 3, 5, 5, 7, 9, 9, 9, 10, 12])).toEqual({
      n: 10,
      nLower: 2,
      nEqual: 2,
      nHigher: 6,
      percentile: 30,
    });
  });

  test("the highest of ten distinct values is 95, not 100", () => {
    // 9 lower, itself equal: 100 × (9 + 0.5) / 10 = 95.
    expect(midRankPercentile(12, [1, 2, 3, 4, 5, 6, 7, 8, 9, 12])).toEqual({
      n: 10,
      nLower: 9,
      nEqual: 1,
      nHigher: 0,
      percentile: 95,
    });
  });

  test("the lowest of ten distinct values is 5, not 0", () => {
    expect(midRankPercentile(1, [1, 2, 3, 4, 5, 6, 7, 8, 9, 12])?.percentile).toBe(5);
  });

  test("everyone equal is 50", () => {
    expect(midRankPercentile(4, [4, 4, 4, 4])?.percentile).toBe(50);
  });

  test("a value that is not among the values has no rank", () => {
    expect(midRankPercentile(6, [1, 2, 3])).toBeNull();
    expect(midRankPercentile(6, [])).toBeNull();
  });
});

describe("latestPerSubject", () => {
  test("one reading per person: the newest, a tie at one instant to the lower id", () => {
    const tieB = row("p02", 2, 63, "/min", "b");
    const tieA = row("p02", 2, 61, "/min", "a");
    const latest = latestPerSubject([row("p01", 0, 100), row("p01", 3, 60), tieB, tieA]);
    expect([...latest.entries()].map(([ref, reading]) => [ref, reading.value])).toEqual([
      ["p01", 60],
      ["p02", 61],
    ]);
  });

  test("no readings is an empty map", () => {
    expect(latestPerSubject([]).size).toBe(0);
  });
});

describe("cohortPositionInput", () => {
  test("is closed and needs start before end", () => {
    expect(cohortPositionInput.safeParse(INPUT).success).toBe(true);
    expect(cohortPositionInput.safeParse({ ...INPUT, cohort_id: COHORT }).success).toBe(
      false,
    );
    expect(
      cohortPositionInput.safeParse({ ...INPUT, start: "2024-02-01", end: "2024-01-01" })
        .success,
    ).toBe(false);
  });
});

describe("cohort_position", () => {
  test("January heart rate: exact output, one cohort read, audited with 13 rows", async () => {
    const { ports, audits, queries } = fakePorts();
    const result = await runCohortPosition(synthetic, INPUT, ports);
    // Latest values: subject 70; peers 60, 62, 65, 70, 74, 78, 80, 84, 88, 95.
    // 3 lower, 2 equal (the subject and p04), 6 higher: 100 × (3 + 1) / 11.
    expect(result).toEqual({
      loinc: HR,
      unit: "/min",
      start: "2024-01-01",
      end: "2024-01-31",
      cohort_id: COHORT,
      effective_at: "2024-01-06T08:00:00.000Z",
      value: 70,
      n: 11,
      n_lower: 3,
      n_equal: 2,
      n_higher: 6,
      percentile: 400 / 11,
      method: "mid-rank",
      rows_read: 13,
    });
    expect(queries).toEqual([
      {
        cohortId: COHORT,
        loinc: HR,
        start: new Date("2024-01-01T00:00:00.000Z"),
        end: new Date("2024-01-31T23:59:59.999Z"),
        take: 20_001,
      },
    ]);
    expect(audits).toEqual([
      {
        actor: "local",
        sessionId: "turn",
        subjectRef: SUBJECT,
        tool: "cohort_position",
        args: INPUT,
        result,
        rowCount: 13,
      },
    ]);
  });

  test("fewer than 10 people with a value is refused with the count", async () => {
    const nine = FIXTURE.filter((fixture) => !["p09", "p10"].includes(fixture.subjectRef));
    const { ports, audits } = fakePorts(nine);
    expect(await runCohortPosition(synthetic, INPUT, ports)).toEqual({
      code: "COHORT_TOO_SMALL",
      error: "fewer than 10 people in this cohort have a value for this code in this window",
      loinc: HR,
      n: 9,
      minimum: 10,
    });
    expect(cohortTooSmall(HR, 9).n).toBe(9);
    expect(audits.map((audit) => audit.rowCount)).toEqual([0]);
  });

  test("exactly 10 people with a value is enough", async () => {
    const ten = FIXTURE.filter((fixture) => fixture.subjectRef !== "p10");
    const { ports } = fakePorts(ten);
    const result = await runCohortPosition(synthetic, INPUT, ports);
    // 60, 62, 65 lower; 70 twice; 74 … 88 higher: 100 × (3 + 1) / 10 = 40.
    expect(result).toMatchObject({ n: 10, n_lower: 3, n_equal: 2, n_higher: 5 });
    expect("percentile" in result ? result.percentile : null).toBe(40);
  });

  test("no reading for the subject in the window is NO_ROWS", async () => {
    const { ports, audits } = fakePorts([
      ...FIXTURE.filter((fixture) => fixture.subjectRef !== SUBJECT),
      row(SUBJECT, 40, 50),
    ]);
    expect(await runCohortPosition(synthetic, INPUT, ports)).toEqual(noRows(HR, null));
    expect(audits.map((audit) => audit.rowCount)).toEqual([0]);
  });

  test("an empty window is NO_ROWS, never a percentile of 0", async () => {
    const { ports } = fakePorts();
    expect(await runCohortPosition(synthetic, { ...INPUT, ...MAR }, ports)).toEqual({
      code: "NO_ROWS",
      error: "no observation for this code in this window",
      loinc: HR,
    });
  });

  test("two units anywhere in the cohort is refused, not ranked", async () => {
    const { ports, audits } = fakePorts([...FIXTURE, row("p05", 1, 75, "{beats}/min")]);
    expect(await runCohortPosition(synthetic, INPUT, ports)).toEqual(
      mixedUnits(HR, ["/min", "{beats}/min"]),
    );
    expect(audits.map((audit) => audit.rowCount)).toEqual([0]);
  });

  test("personal mode is refused before any read and audited with 0 rows", async () => {
    const { ports, audits, queries } = fakePorts();
    expect(await runCohortPosition(personal, INPUT, ports)).toEqual(
      SUBJECT_SCOPE_VIOLATION,
    );
    expect(queries).toEqual([]);
    expect(audits.map((audit) => [audit.tool, audit.rowCount])).toEqual([
      ["cohort_position", 0],
    ]);
  });

  test("a subject that is not synthetic is refused without reading rows", async () => {
    const { ports, queries } = fakePorts();
    const input = { ...INPUT, subject_ref: NOT_SYNTHETIC };
    expect(await runCohortPosition(synthetic, input, ports)).toEqual(
      SUBJECT_SCOPE_VIOLATION,
    );
    expect(queries).toEqual([]);
  });

  test("a subject outside the cohort allowlist is refused without reading rows", async () => {
    const { ports, audits, queries } = fakePorts();
    const input = { ...INPUT, subject_ref: UNLISTED };
    expect(await runCohortPosition(synthetic, input, ports)).toEqual(
      SUBJECT_SCOPE_VIOLATION,
    );
    expect(queries).toEqual([]);
    expect(audits.map((audit) => [audit.subjectRef, audit.rowCount])).toEqual([
      [UNLISTED, 0],
    ]);
  });

  test("an unknown subject is refused without reading rows", async () => {
    const { ports, queries } = fakePorts();
    const input = { ...INPUT, subject_ref: "not-in-cohort-001" };
    expect(await runCohortPosition(synthetic, input, ports)).toEqual(
      SUBJECT_SCOPE_VIOLATION,
    );
    expect(queries).toEqual([]);
  });

  test("more than 20000 cohort rows is refused, not truncated; 20000 is accepted", async () => {
    const dense = (count: number) => [
      ...FIXTURE,
      ...Array.from({ length: count - 13 }, (_, minute) => ({
        ...row("p03", 0, 65),
        id: `dense-${minute}`,
        effectiveAt: new Date(T0 + minute * 60_000),
      })),
    ];
    const over = fakePorts(dense(20_001));
    expect(await runCohortPosition(synthetic, INPUT, over.ports)).toEqual({
      code: "COHORT_ROW_CAP_EXCEEDED",
      error:
        "more than 20000 observations for this code across the cohort in this window; narrow the window",
    });
    expect(COHORT_ROW_CAP_EXCEEDED.code).toBe("COHORT_ROW_CAP_EXCEEDED");
    expect(over.audits.map((audit) => audit.rowCount)).toEqual([0]);
    const at = fakePorts(dense(20_000));
    expect(await runCohortPosition(synthetic, INPUT, at.ports)).toMatchObject({
      n: 11,
      rows_read: 20_000,
    });
    expect(at.audits.map((audit) => audit.rowCount)).toEqual([20_000]);
  });

  test("a read that throws is still audited with 0 rows and no message", async () => {
    const { ports: base, audits } = fakePorts();
    const ports: QueryToolPorts = {
      ...base,
      findCohortObservations: () => Promise.reject(new Error("synthetic database down")),
    };
    await expect(runCohortPosition(synthetic, INPUT, ports)).rejects.toThrow(
      "synthetic database down",
    );
    expect(audits.map((audit) => [audit.result, audit.rowCount])).toEqual([
      [QUERY_TOOL_FAILED, 0],
    ]);
  });
});
