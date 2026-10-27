import { describe, expect, test } from "bun:test";

import type { AppendInput } from "@/packages/audit/append";

import { conditionsTimeline, statusCounts } from "./clinical-timeline";
import type {
  ClinicalQuery,
  ConditionRecord,
  QueryToolPorts,
  SubjectScopeRow,
} from "./ports";
import { conditionsTimelineInput } from "./schemas";
import { SUBJECT_SCOPE_VIOLATION, type SessionScope } from "./scope";
import { QUERY_TOOL_FAILED, runConditionsTimeline } from "./tools";

/**
 * `conditions_timeline` over synthetic records. Every expected value is
 * written out by hand, never computed by the code under test.
 */

const SUBJECT = "synthetic-conditions-subject";
const UNLISTED = "unlisted-cohort-subject";

const SUBJECTS: Readonly<Record<string, SubjectScopeRow>> = {
  [SUBJECT]: { isSynthetic: true, cohortId: "synthea-v4-seed42" },
  [UNLISTED]: { isSynthetic: true, cohortId: "synthea-unlisted" },
};

type FakeCondition = ConditionRecord & Readonly<{ subjectRef: string }>;

const SNOMED = "http://snomed.info/sct";
const ICD10 = "http://hl7.org/fhir/sid/icd-10";

const condition = (
  id: string,
  code: string,
  display: string,
  onset: string | null,
  abatement: string | null,
  clinicalStatus: string | null,
  codeSystem = SNOMED,
): FakeCondition => ({
  subjectRef: SUBJECT,
  id,
  codeSystem,
  code,
  display,
  onsetAt: onset === null ? null : new Date(onset),
  abatementAt: abatement === null ? null : new Date(abatement),
  clinicalStatus,
  verificationStatus: clinicalStatus === null ? null : "confirmed",
});

/** A synthetic history: two sinusitis episodes, hypertension still open, an old fracture. */
const FIXTURE: readonly FakeCondition[] = [
  condition(
    "c4",
    "444814009",
    "Viral sinusitis (disorder)",
    "2021-03-02T09:00:00Z",
    "2021-03-20T09:00:00Z",
    "resolved",
  ),
  condition(
    "c2",
    "59621000",
    "Essential hypertension (disorder)",
    "2018-11-05T10:00:00Z",
    null,
    "active",
  ),
  condition(
    "c1",
    "16114001",
    "Fracture of ankle",
    "2005-06-01T12:00:00Z",
    "2005-08-01T12:00:00Z",
    "resolved",
  ),
  condition(
    "c3",
    "444814009",
    "Viral sinusitis (disorder)",
    "2019-01-10T08:00:00Z",
    "2019-01-28T08:00:00Z",
    "resolved",
  ),
  condition(
    "c5",
    "I10",
    "Essential (primary) hypertension",
    "2018-11-05T10:00:00Z",
    null,
    null,
    ICD10,
  ),
];

/** The default read's rule, in memory: span overlaps the window, filters, then order. */
const overlaps = (row: ConditionRecord, query: ClinicalQuery): boolean =>
  row.onsetAt !== null &&
  row.onsetAt.getTime() <= query.end.getTime() &&
  (row.abatementAt === null || row.abatementAt.getTime() >= query.start.getTime());

const fakePorts = (rows: readonly FakeCondition[] = FIXTURE) => {
  const audits: AppendInput[] = [];
  const queries: ClinicalQuery[] = [];
  const ports: QueryToolPorts = {
    findSubject: async (subjectRef) => SUBJECTS[subjectRef] ?? null,
    findObservations: async () => [],
    findConditions: async (query) => {
      queries.push(query);
      return rows
        .filter(
          (row) =>
            row.subjectRef === query.subjectRef &&
            overlaps(row, query) &&
            (query.status === undefined || row.clinicalStatus === query.status) &&
            (query.code === undefined || row.code === query.code),
        )
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

const INPUT = { subject_ref: SUBJECT, start: "2019-01-01", end: "2021-12-31" };

/** The four conditions overlapping 2019–2021, written out (the fracture ended in 2005). */
const conditionsTimelineOfFour = {
  n: 4,
  n_codes: 3,
  by_status: { active: 1, resolved: 2, unrecorded: 1 },
  n_without_abatement: 2,
  conditions: [
    {
      code_system: SNOMED,
      code: "59621000",
      display: "Essential hypertension (disorder)",
      onset_at: "2018-11-05T10:00:00.000Z",
      abatement_at: null,
      clinical_status: "active",
      verification_status: "confirmed",
    },
    {
      code_system: ICD10,
      code: "I10",
      display: "Essential (primary) hypertension",
      onset_at: "2018-11-05T10:00:00.000Z",
      abatement_at: null,
      clinical_status: null,
      verification_status: null,
    },
    {
      code_system: SNOMED,
      code: "444814009",
      display: "Viral sinusitis (disorder)",
      onset_at: "2019-01-10T08:00:00.000Z",
      abatement_at: "2019-01-28T08:00:00.000Z",
      clinical_status: "resolved",
      verification_status: "confirmed",
    },
    {
      code_system: SNOMED,
      code: "444814009",
      display: "Viral sinusitis (disorder)",
      onset_at: "2021-03-02T09:00:00.000Z",
      abatement_at: "2021-03-20T09:00:00.000Z",
      clinical_status: "resolved",
      verification_status: "confirmed",
    },
  ],
} as const;

describe("conditionsTimeline", () => {
  test("orders by onset, then code, then id; counts by recorded status", () => {
    const four = FIXTURE.filter((row) => row.id !== "c1");
    expect(conditionsTimeline(four)).toEqual(conditionsTimelineOfFour);
    expect(conditionsTimeline(four.toReversed())).toEqual(conditionsTimelineOfFour);
  });

  test("no records: zero counts, an empty list", () => {
    expect(conditionsTimeline([])).toEqual({
      n: 0,
      n_codes: 0,
      by_status: {},
      n_without_abatement: 0,
      conditions: [],
    });
  });

  test("statusCounts sorts its keys and names a missing status", () => {
    expect(
      Object.entries(statusCounts(["resolved", null, "active", "resolved"])),
    ).toEqual([
      ["active", 1],
      ["resolved", 2],
      ["unrecorded", 1],
    ]);
  });
});

describe("conditionsTimelineInput", () => {
  test("is closed: unknown keys, a free-text status and a reversed window are refused", () => {
    expect(conditionsTimelineInput.safeParse(INPUT).success).toBe(true);
    expect(conditionsTimelineInput.safeParse({ ...INPUT, loinc: "8867-4" }).success).toBe(
      false,
    );
    expect(
      conditionsTimelineInput.safeParse({ ...INPUT, status: "chronic" }).success,
    ).toBe(false);
    expect(
      conditionsTimelineInput.safeParse({ ...INPUT, code: "I10; drop table" }).success,
    ).toBe(false);
    expect(
      conditionsTimelineInput.safeParse({ ...INPUT, start: "2022-01-01" }).success,
    ).toBe(false);
  });
});

describe("conditions_timeline", () => {
  test("2019–2021: the four overlapping conditions, audited with 4 rows", async () => {
    const { ports, audits, queries } = fakePorts();
    const result = await runConditionsTimeline(synthetic, INPUT, ports);
    expect(result).toEqual({
      subject_ref: SUBJECT,
      start: "2019-01-01",
      end: "2021-12-31",
      status: null,
      code: null,
      ...conditionsTimelineOfFour,
    });
    expect(queries).toEqual([
      {
        subjectRef: SUBJECT,
        start: new Date("2019-01-01T00:00:00.000Z"),
        end: new Date("2021-12-31T23:59:59.999Z"),
        take: 1001,
      },
    ]);
    expect(audits).toEqual([
      {
        actor: "local",
        sessionId: "turn",
        subjectRef: SUBJECT,
        tool: "conditions_timeline",
        args: INPUT,
        result,
        rowCount: 4,
      },
    ]);
  });

  test("status and code narrow the read and are echoed", async () => {
    const { ports, queries } = fakePorts();
    const input = { ...INPUT, status: "resolved" as const, code: "444814009" };
    const result = await runConditionsTimeline(synthetic, input, ports);
    expect(result).toMatchObject({
      status: "resolved",
      code: "444814009",
      n: 2,
      n_codes: 1,
      by_status: { resolved: 2 },
      n_without_abatement: 0,
    });
    expect(queries[0]).toMatchObject({ status: "resolved", code: "444814009" });
  });

  test("nothing in the window is NO_ROWS with the reason, audited with 0 rows", async () => {
    const { ports, audits } = fakePorts();
    const input = { subject_ref: SUBJECT, start: "2010-01-01", end: "2014-12-31" };
    expect(await runConditionsTimeline(synthetic, input, ports)).toEqual({
      code: "NO_ROWS",
      error:
        "no condition is recorded for this subject with a span (onset to abatement, or still open) that overlaps this window",
      record: "condition",
    });
    expect(audits.map((audit) => audit.rowCount)).toEqual([0]);
  });

  test("a filter that matches nothing names the filter in the reason", async () => {
    const { ports } = fakePorts();
    const input = { ...INPUT, status: "remission" as const, code: "I10" };
    expect(await runConditionsTimeline(synthetic, input, ports)).toEqual({
      code: "NO_ROWS",
      error:
        "no condition with code I10 and clinical status remission is recorded for this subject with a span (onset to abatement, or still open) that overlaps this window",
      record: "condition",
    });
  });

  test("personal mode is refused before any read and audited with 0 rows", async () => {
    const { ports, audits, queries } = fakePorts();
    expect(await runConditionsTimeline(personal, INPUT, ports)).toEqual(
      SUBJECT_SCOPE_VIOLATION,
    );
    expect(queries).toEqual([]);
    expect(audits.map((audit) => [audit.tool, audit.rowCount])).toEqual([
      ["conditions_timeline", 0],
    ]);
  });

  test("a subject outside the cohort allowlist is refused without reading", async () => {
    const { ports, audits, queries } = fakePorts();
    const input = { ...INPUT, subject_ref: UNLISTED };
    expect(await runConditionsTimeline(synthetic, input, ports)).toEqual(
      SUBJECT_SCOPE_VIOLATION,
    );
    expect(queries).toEqual([]);
    expect(audits.map((audit) => [audit.subjectRef, audit.rowCount])).toEqual([
      [UNLISTED, 0],
    ]);
  });

  test("more than 1000 records is refused, not cut short", async () => {
    const many = Array.from({ length: 1001 }, (_, index) =>
      condition(
        `m${index}`,
        "444814009",
        "Viral sinusitis (disorder)",
        "2020-01-01T00:00:00Z",
        null,
        "active",
      ),
    );
    const { ports, audits } = fakePorts(many);
    expect(await runConditionsTimeline(synthetic, INPUT, ports)).toEqual({
      code: "ROW_CAP_EXCEEDED",
      error: "more than 1000 records in this window; narrow the window",
    });
    expect(audits.map((audit) => audit.rowCount)).toEqual([0]);
  });

  test("a read that throws is still audited with 0 rows and no message", async () => {
    const { ports: base, audits } = fakePorts();
    const ports: QueryToolPorts = {
      ...base,
      findConditions: () => Promise.reject(new Error("synthetic database down")),
    };
    await expect(runConditionsTimeline(synthetic, INPUT, ports)).rejects.toThrow(
      "synthetic database down",
    );
    expect(audits.map((audit) => [audit.result, audit.rowCount])).toEqual([
      [QUERY_TOOL_FAILED, 0],
    ]);
  });
});
