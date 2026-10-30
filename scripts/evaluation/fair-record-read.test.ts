import { describe, expect, test } from "bun:test";

import { EMPTY_COHORT, type FairRecordPorts, readFairRecord } from "./fair-record-read";

/** Synthetic refs and rows only. */
const IN_SCOPE = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000b";
const REFUSAL = { code: "SUBJECT_SCOPE_VIOLATION", error: "not in scope" };

const ports = (overrides: Partial<FairRecordPorts> = {}) => {
  const reads: string[] = [];
  const base: FairRecordPorts = {
    listSubjects: async () => ({
      subjects: [{ subject_ref: OTHER }, { subject_ref: IN_SCOPE }],
    }),
    subjectWindow: async (ref) =>
      ref === IN_SCOPE ? { start: null, end: null, n_observations: 1 } : REFUSAL,
    observations: async (ref) => {
      reads.push(`observations ${ref}`);
      return [
        {
          loinc: "4548-4",
          display: "HbA1c",
          unit: "%",
          value: 6,
          at: "2024-01-01T00:00:00.000Z",
        },
      ];
    },
    conditions: async (ref) => {
      reads.push(`conditions ${ref}`);
      return [];
    },
    medications: async (ref) => {
      reads.push(`medications ${ref}`);
      return [];
    },
    ...overrides,
  };
  return { ports: base, reads };
};

describe("readFairRecord", () => {
  test("a subject in scope: the scope check, then its whole record", async () => {
    const { ports: fake, reads } = ports();
    const { read, gate } = await readFairRecord(fake, {
      kind: "named",
      subjectRef: IN_SCOPE,
    });
    expect(read.kind).toBe("record");
    if (read.kind === "record") expect(read.record.observations.length).toBe(1);
    expect(gate.map((call) => call.tool)).toEqual(["subject_window"]);
    expect(reads).toEqual([
      `observations ${IN_SCOPE}`,
      `conditions ${IN_SCOPE}`,
      `medications ${IN_SCOPE}`,
    ]);
  });

  test("a refused subject: the tool's refusal, and nothing else is read", async () => {
    const { ports: fake, reads } = ports();
    const { read } = await readFairRecord(fake, {
      kind: "named",
      subjectRef: "not-in-cohort-001",
    });
    expect(read).toEqual({
      kind: "refused",
      subjectRef: "not-in-cohort-001",
      code: "SUBJECT_SCOPE_VIOLATION",
    });
    expect(reads).toEqual([]);
  });

  test("the first subject in a cohort is its lowest subject_ref", async () => {
    const { ports: fake } = ports({
      subjectWindow: async () => ({ start: null, end: null, n_observations: 0 }),
    });
    const { read, gate } = await readFairRecord(fake, {
      kind: "first-in-cohort",
      cohortId: "synthea-v4-seed42",
    });
    expect(read.kind === "record" ? read.record.subjectRef : null).toBe(IN_SCOPE);
    expect(gate.map((call) => call.tool)).toEqual(["list_subjects", "subject_window"]);
  });

  test("a refused or empty cohort listing names no subject", async () => {
    const refused = await readFairRecord(
      ports({ listSubjects: async () => ({ code: "COHORT_OUT_OF_SCOPE", error: "no" }) })
        .ports,
      { kind: "first-in-cohort", cohortId: "vitronic-real" },
    );
    expect(refused.read).toEqual({
      kind: "refused",
      subjectRef: null,
      code: "COHORT_OUT_OF_SCOPE",
    });
    const empty = await readFairRecord(
      ports({ listSubjects: async () => ({ subjects: [] }) }).ports,
      { kind: "first-in-cohort", cohortId: "synthea-v4-seed42" },
    );
    expect(empty.read).toEqual({ kind: "refused", subjectRef: null, code: EMPTY_COHORT });
  });
});
