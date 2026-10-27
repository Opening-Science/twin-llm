import { describe, expect, test } from "bun:test";

import type { AppendInput } from "@/packages/audit/append";

import { medicationsTimeline } from "./clinical-timeline";
import type {
  ClinicalQuery,
  MedicationRequestRecord,
  QueryToolPorts,
  SubjectScopeRow,
} from "./ports";
import { medicationsTimelineInput } from "./schemas";
import { SUBJECT_SCOPE_VIOLATION, type SessionScope } from "./scope";
import { QUERY_TOOL_FAILED, runMedicationsTimeline } from "./tools";

/**
 * `medications_timeline` over synthetic records. Every expected value is
 * written out by hand, never computed by the code under test.
 */

const SUBJECT = "synthetic-medications-subject";
const UNLISTED = "unlisted-cohort-subject";
const RXNORM = "http://www.nlm.nih.gov/research/umls/rxnorm";

const SUBJECTS: Readonly<Record<string, SubjectScopeRow>> = {
  [SUBJECT]: { isSynthetic: true, cohortId: "synthea-v4-seed42" },
  [UNLISTED]: { isSynthetic: true, cohortId: "synthea-unlisted" },
};

type FakeRequest = MedicationRequestRecord & Readonly<{ subjectRef: string }>;

const request = (
  id: string,
  code: string,
  display: string,
  authored: string,
  status: string | null,
  dosageText: readonly string[] = [],
): FakeRequest => ({
  subjectRef: SUBJECT,
  id,
  codeSystem: RXNORM,
  code,
  display,
  authoredAt: new Date(authored),
  status,
  intent: "order",
  dosageText,
});

/** Synthetic requests: two of one tablet, an inhaler with recorded text, one older. */
const FIXTURE: readonly FakeRequest[] = [
  request(
    "m3",
    "895996",
    "120 ACTUAT fluticasone propionate 0.044 MG/ACTUAT Metered Dose Inhaler [Flovent]",
    "2021-09-06T16:07:09Z",
    "active",
    ["Take as needed."],
  ),
  request(
    "m2",
    "314076",
    "lisinopril 10 MG Oral Tablet",
    "2020-11-05T10:15:00Z",
    "completed",
  ),
  request(
    "m1",
    "313782",
    "Acetaminophen 325 MG Oral Tablet",
    "2012-04-02T09:20:00Z",
    "completed",
  ),
  request("m4", "314076", "lisinopril 10 MG Oral Tablet", "2021-11-05T10:15:00Z", null),
];

const fakePorts = (rows: readonly FakeRequest[] = FIXTURE) => {
  const audits: AppendInput[] = [];
  const queries: ClinicalQuery[] = [];
  const ports: QueryToolPorts = {
    findSubject: async (subjectRef) => SUBJECTS[subjectRef] ?? null,
    findObservations: async () => [],
    findMedicationRequests: async (query) => {
      queries.push(query);
      return rows
        .filter(
          (row) =>
            row.subjectRef === query.subjectRef &&
            row.authoredAt !== null &&
            row.authoredAt.getTime() >= query.start.getTime() &&
            row.authoredAt.getTime() <= query.end.getTime() &&
            (query.status === undefined || row.status === query.status) &&
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

const INPUT = { subject_ref: SUBJECT, start: "2020-01-01", end: "2021-12-31" };

/** The three requests authored in 2020–2021, written out (m1 is from 2012). */
const THREE = {
  n: 3,
  n_codes: 2,
  by_status: { active: 1, completed: 1, unrecorded: 1 },
  n_with_dosage_text: 1,
  medications: [
    {
      code_system: RXNORM,
      code: "314076",
      display: "lisinopril 10 MG Oral Tablet",
      authored_at: "2020-11-05T10:15:00.000Z",
      status: "completed",
      intent: "order",
      dosage_as_recorded: null,
    },
    {
      code_system: RXNORM,
      code: "895996",
      display:
        "120 ACTUAT fluticasone propionate 0.044 MG/ACTUAT Metered Dose Inhaler [Flovent]",
      authored_at: "2021-09-06T16:07:09.000Z",
      status: "active",
      intent: "order",
      dosage_as_recorded: ["Take as needed."],
    },
    {
      code_system: RXNORM,
      code: "314076",
      display: "lisinopril 10 MG Oral Tablet",
      authored_at: "2021-11-05T10:15:00.000Z",
      status: null,
      intent: "order",
      dosage_as_recorded: null,
    },
  ],
} as const;

describe("medicationsTimeline", () => {
  test("orders by authored date; dosage text verbatim or null, never made up", () => {
    const three = FIXTURE.filter((row) => row.id !== "m1");
    expect(medicationsTimeline(three)).toEqual(THREE);
    expect(medicationsTimeline(three.toReversed())).toEqual(THREE);
  });

  test("no records: zero counts, an empty list", () => {
    expect(medicationsTimeline([])).toEqual({
      n: 0,
      n_codes: 0,
      by_status: {},
      n_with_dosage_text: 0,
      medications: [],
    });
  });
});

describe("medicationsTimelineInput", () => {
  test("is closed: unknown keys and a free-text status are refused", () => {
    expect(medicationsTimelineInput.safeParse(INPUT).success).toBe(true);
    expect(
      medicationsTimelineInput.safeParse({ ...INPUT, dose: "double it" }).success,
    ).toBe(false);
    expect(
      medicationsTimelineInput.safeParse({ ...INPUT, status: "taking" }).success,
    ).toBe(false);
    expect(
      medicationsTimelineInput.safeParse({ ...INPUT, status: "on-hold" }).success,
    ).toBe(true);
  });
});

describe("medications_timeline", () => {
  test("2020–2021: the three requests, audited with 3 rows", async () => {
    const { ports, audits, queries } = fakePorts();
    const result = await runMedicationsTimeline(synthetic, INPUT, ports);
    expect(result).toEqual({
      subject_ref: SUBJECT,
      start: "2020-01-01",
      end: "2021-12-31",
      status: null,
      code: null,
      ...THREE,
    });
    expect(queries).toEqual([
      {
        subjectRef: SUBJECT,
        start: new Date("2020-01-01T00:00:00.000Z"),
        end: new Date("2021-12-31T23:59:59.999Z"),
        take: 1001,
      },
    ]);
    expect(audits).toEqual([
      {
        actor: "local",
        sessionId: "turn",
        subjectRef: SUBJECT,
        tool: "medications_timeline",
        args: INPUT,
        result,
        rowCount: 3,
      },
    ]);
  });

  test("a code filter lists that medicine only", async () => {
    const { ports } = fakePorts();
    const result = await runMedicationsTimeline(
      synthetic,
      { ...INPUT, code: "314076" },
      ports,
    );
    expect(result).toMatchObject({
      code: "314076",
      n: 2,
      n_codes: 1,
      by_status: { completed: 1, unrecorded: 1 },
      n_with_dosage_text: 0,
    });
  });

  test("nothing authored in the window is NO_ROWS with the reason", async () => {
    const { ports, audits } = fakePorts();
    const input = { ...INPUT, status: "stopped" as const };
    expect(await runMedicationsTimeline(synthetic, input, ports)).toEqual({
      code: "NO_ROWS",
      error:
        "no medication request with status stopped is recorded for this subject as authored in this window",
      record: "medication request",
    });
    expect(audits.map((audit) => audit.rowCount)).toEqual([0]);
  });

  test("personal mode and an unlisted cohort are refused before any read", async () => {
    const { ports, audits, queries } = fakePorts();
    expect(await runMedicationsTimeline(personal, INPUT, ports)).toEqual(
      SUBJECT_SCOPE_VIOLATION,
    );
    expect(
      await runMedicationsTimeline(synthetic, { ...INPUT, subject_ref: UNLISTED }, ports),
    ).toEqual(SUBJECT_SCOPE_VIOLATION);
    expect(queries).toEqual([]);
    expect(audits.map((audit) => [audit.subjectRef, audit.rowCount])).toEqual([
      [SUBJECT, 0],
      [UNLISTED, 0],
    ]);
  });

  test("more than 1000 records is refused, not cut short", async () => {
    const many = Array.from({ length: 1001 }, (_, index) =>
      request(
        `x${index}`,
        "314076",
        "lisinopril 10 MG Oral Tablet",
        "2020-06-01T00:00:00Z",
        "completed",
      ),
    );
    const { ports, audits } = fakePorts(many);
    expect(await runMedicationsTimeline(synthetic, INPUT, ports)).toEqual({
      code: "ROW_CAP_EXCEEDED",
      error: "more than 1000 records in this window; narrow the window",
    });
    expect(audits.map((audit) => audit.rowCount)).toEqual([0]);
  });

  test("a read that throws is still audited with 0 rows and no message", async () => {
    const { ports: base, audits } = fakePorts();
    const ports: QueryToolPorts = {
      ...base,
      findMedicationRequests: () => Promise.reject(new Error("synthetic database down")),
    };
    await expect(runMedicationsTimeline(synthetic, INPUT, ports)).rejects.toThrow(
      "synthetic database down",
    );
    expect(audits.map((audit) => [audit.result, audit.rowCount])).toEqual([
      [QUERY_TOOL_FAILED, 0],
    ]);
  });
});
