import { describe, expect, test } from "bun:test";

import type { AppendInput } from "@/packages/audit/append";

import type {
  ConditionRecord,
  MedicationRequestRecord,
  ObservationRecord,
  QueryToolPorts,
  SubjectScopeRow,
} from "./ports";
import { SUBJECT_SCOPE_VIOLATION, type SessionScope } from "./scope";
import { runValuesAroundEvent } from "./tools";

/**
 * `values_around_event` over synthetic rows: blood pressure before and after
 * a made-up hypertension onset and a made-up medication request. Every
 * expected value is computed by hand.
 */

const SUBJECT = "synthetic-event-subject";
const OTHER = "unlisted-subject";
const SYS = "8480-6";
const HYPERTENSION = "59621000";
const LISINOPRIL = "314076";

const SUBJECTS: Readonly<Record<string, SubjectScopeRow>> = {
  [SUBJECT]: { isSynthetic: true, cohortId: "synthea-v4-seed42" },
  [OTHER]: { isSynthetic: true, cohortId: "synthea-unlisted" },
};

const at = (iso: string) => new Date(iso);
let nextId = 0;
const reading = (iso: string, value: number, unit = "mm[Hg]") => ({
  id: BigInt(++nextId),
  subjectRef: SUBJECT,
  loinc: SYS,
  value,
  unitUcum: unit,
  effectiveAt: at(iso),
});

// Onset 1 March 2020. Before (30 days): 150, 154. After (30 days): 140, 136, 138.
const ROWS = [
  reading("2020-01-15T09:00:00Z", 170), // outside the 30 days before
  reading("2020-02-10T09:00:00Z", 150),
  reading("2020-02-25T09:00:00Z", 154),
  reading("2020-03-01T08:00:00Z", 140), // at the onset instant: counts as after
  reading("2020-03-15T09:00:00Z", 136),
  reading("2020-03-30T09:00:00Z", 138),
  reading("2020-05-01T09:00:00Z", 120), // outside the 30 days after
];

const CONDITIONS: readonly ConditionRecord[] = [
  {
    id: "c2",
    codeSystem: "http://snomed.info/sct",
    code: HYPERTENSION,
    display: "Essential hypertension (disorder)",
    onsetAt: at("2020-03-01T08:00:00Z"),
    abatementAt: null,
    clinicalStatus: "active",
    verificationStatus: "confirmed",
  },
  {
    id: "c9",
    codeSystem: "http://snomed.info/sct",
    code: HYPERTENSION,
    display: "Essential hypertension (disorder)",
    onsetAt: at("2023-06-01T08:00:00Z"),
    abatementAt: null,
    clinicalStatus: "active",
    verificationStatus: "confirmed",
  },
];

const MEDICATIONS: readonly MedicationRequestRecord[] = [
  {
    id: "m1",
    codeSystem: "http://www.nlm.nih.gov/research/umls/rxnorm",
    code: LISINOPRIL,
    display: "lisinopril 10 MG Oral Tablet",
    authoredAt: at("2020-03-01T08:00:00Z"),
    status: "active",
    intent: "order",
    dosageText: [],
  },
];

const fakePorts = (rows: readonly ObservationRecord[] = ROWS) => {
  const audits: AppendInput[] = [];
  const ports: QueryToolPorts = {
    findSubject: async (ref) => SUBJECTS[ref] ?? null,
    findObservations: async (query) =>
      rows
        .filter(
          (row) =>
            query.loinc.includes(row.loinc) &&
            row.effectiveAt.getTime() >= query.start.getTime() &&
            row.effectiveAt.getTime() <= query.end.getTime(),
        )
        .slice(0, query.take),
    findConditions: async (query) =>
      CONDITIONS.filter((row) => query.code === undefined || row.code === query.code),
    findMedicationRequests: async (query) =>
      MEDICATIONS.filter((row) => query.code === undefined || row.code === query.code),
    appendAudit: async (input) => {
      audits.push(input);
    },
  };
  return { ports, audits };
};

const synthetic: SessionScope = { actor: "local", sessionId: "turn", mode: "synthetic" };

const INPUT = {
  subject_ref: SUBJECT,
  loinc: SYS,
  event_kind: "condition",
  event_code: HYPERTENSION,
  days_before: 30,
  days_after: 30,
} as const;

describe("values_around_event", () => {
  test("summarises the readings before and from the first onset", async () => {
    const { ports, audits } = fakePorts();
    const result = await runValuesAroundEvent(synthetic, INPUT, ports);
    if ("code" in result) throw new Error(result.code);
    expect(result.event).toEqual({
      kind: "condition",
      code_system: "http://snomed.info/sct",
      code: HYPERTENSION,
      display: "Essential hypertension (disorder)",
      at: "2020-03-01T08:00:00.000Z",
      n_records: 2,
    });
    expect(result.unit).toBe("mm[Hg]");
    expect([result.before.n, result.before.mean, result.before.median]).toEqual([
      2, 152, 152,
    ]);
    expect([result.after.n, result.after.mean, result.after.median]).toEqual([
      3, 138, 138,
    ]);
    expect([result.after.min, result.after.max]).toEqual([136, 140]);
    expect(result.delta_after_minus_before).toEqual({
      mean: -14,
      median: -14,
      min: -14,
      max: -14,
    });
    expect(audits.map((audit) => [audit.tool, audit.rowCount])).toEqual([
      ["values_around_event", 5],
    ]);
  });

  test("a medication's first request works the same way", async () => {
    const { ports } = fakePorts();
    const result = await runValuesAroundEvent(
      synthetic,
      { ...INPUT, event_kind: "medication", event_code: LISINOPRIL },
      ports,
    );
    if ("code" in result) throw new Error(result.code);
    expect(result.event.display).toBe("lisinopril 10 MG Oral Tablet");
    expect(result.before.n + result.after.n).toBe(5);
  });

  test("no dated record of that code is NO_ROWS, naming the record", async () => {
    const { ports } = fakePorts();
    const result = await runValuesAroundEvent(
      synthetic,
      { ...INPUT, event_code: "44054006" },
      ports,
    );
    expect(result).toEqual({
      code: "NO_ROWS",
      error:
        "no condition with code 44054006 and a recorded date is on file for this subject",
      record: "condition",
    });
  });

  test("no reading on either side is NO_ROWS", async () => {
    const { ports } = fakePorts([]);
    expect(await runValuesAroundEvent(synthetic, INPUT, ports)).toMatchObject({
      code: "NO_ROWS",
      loinc: SYS,
    });
  });

  test("two units across the windows is MIXED_UNITS", async () => {
    const { ports } = fakePorts([...ROWS, reading("2020-03-20T09:00:00Z", 18, "kPa")]);
    expect(await runValuesAroundEvent(synthetic, INPUT, ports)).toMatchObject({
      code: "MIXED_UNITS",
    });
  });

  test("a subject outside the allowlisted cohorts reads nothing", async () => {
    const { ports } = fakePorts();
    expect(
      await runValuesAroundEvent(synthetic, { ...INPUT, subject_ref: OTHER }, ports),
    ).toEqual(SUBJECT_SCOPE_VIOLATION);
  });
});
