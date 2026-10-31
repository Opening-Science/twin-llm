import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

import { moduleMocker } from "@/tests/support/mock-module";

import { sha256Hex, toCanonicalJson } from "@/packages/audit/hash";

import { SUBJECT_SCOPE_VIOLATION } from "./scope";

type Row = Record<string, unknown>;

const SUBJECT = "4f083ce3-f12b-bb4b-7353-e17f0cd55b0a";
const COHORT = "open-twin-synthea-trimmed-3";
const SEEDED_SUBJECT = "seeded-synthetic-subject";
const SEEDED_EFFECTIVE = new Date("2019-06-01T08:00:00.000Z");
const EFFECTIVE = new Date("2017-02-11T04:29:26+01:00");
const RANGE = {
  start: "2010-01-01T00:00:00.000Z",
  end: "2020-01-01T00:00:00.000Z",
} as const;

const PATIENT2_ROWS = [
  {
    loinc: "8302-2",
    display: "Body Height",
    value: 175.3,
    unitUcum: "cm",
  },
  {
    loinc: "72514-3",
    display: "Pain severity - 0-10 verbal numeric rating [Score] - Reported",
    value: 1,
    unitUcum: "{score}",
  },
  {
    loinc: "29463-7",
    display: "Body Weight",
    value: 85.2,
    unitUcum: "kg",
  },
  {
    loinc: "39156-5",
    display: "Body mass index (BMI) [Ratio]",
    value: 27.72,
    unitUcum: "kg/m2",
  },
  {
    loinc: "59576-9",
    display: "Body mass index (BMI) [Percentile] Per age and sex",
    value: 92.377,
    unitUcum: "%",
  },
] as const;

type AuditRow = {
  seq: bigint;
  ts: Date;
  actor: string;
  sessionId: string;
  subjectRef: string | null;
  tool: string;
  argsSha256: string;
  resultSha256: string;
  rowCount: number;
  prevHash: string;
  hash: string;
};

const store = {
  subjects: new Map<string, Row>(),
  observations: [] as Row[],
  events: [] as AuditRow[],
};

const resetStore = () => {
  store.subjects.clear();
  store.observations.length = 0;
  store.events.length = 0;
};

const seedPatient2 = () => {
  store.subjects.set(SUBJECT, {
    subjectRef: SUBJECT,
    isSynthetic: true,
    cohortId: COHORT,
  });
  for (const row of PATIENT2_ROWS) {
    store.observations.push({
      subjectRef: SUBJECT,
      loinc: row.loinc,
      display: row.display,
      value: row.value,
      unitUcum: row.unitUcum,
      effectiveAt: EFFECTIVE,
    });
  }
};

const matchesWhere = (row: Row, where: Row): boolean => {
  if (where.subjectRef !== undefined && row.subjectRef !== where.subjectRef) return false;
  if (where.cohortId !== undefined && row.cohortId !== where.cohortId) return false;
  if (where.loinc !== undefined) {
    const loinc = where.loinc;
    if (typeof loinc === "string" && row.loinc !== loinc) return false;
    if (
      loinc !== null &&
      typeof loinc === "object" &&
      "in" in loinc &&
      !(loinc as { in: string[] }).in.includes(row.loinc as string)
    ) {
      return false;
    }
  }
  if (where.effectiveAt !== undefined && where.effectiveAt !== null) {
    const range = where.effectiveAt as { gte?: Date; lte?: Date };
    const at = (row.effectiveAt as Date).getTime();
    if (range.gte && at < range.gte.getTime()) return false;
    if (range.lte && at > range.lte.getTime()) return false;
  }
  return true;
};

const mockDb = () => ({
  subject: {
    findUnique: async ({ where }: { where: { subjectRef: string } }) =>
      store.subjects.get(where.subjectRef) ?? null,
    groupBy: async ({ where }: { where: { cohortId: { in: string[] } } }) =>
      [...new Set([...store.subjects.values()].map((row) => row.cohortId))]
        .filter((cohortId) => where.cohortId.in.includes(cohortId))
        .sort()
        .map((cohortId) => ({ cohortId })),
    findMany: async ({
      where,
      take,
    }: {
      where: { cohortId: string; isSynthetic?: boolean };
      take?: number;
    }) => {
      const rows = [...store.subjects.values()]
        .filter((row) => row.cohortId === where.cohortId)
        .filter(
          (row) =>
            where.isSynthetic === undefined || row.isSynthetic === where.isSynthetic,
        )
        .sort((a, b) => String(a.subjectRef).localeCompare(String(b.subjectRef)));
      return take === undefined ? rows : rows.slice(0, take);
    },
  },
  observation: {
    findMany: async ({
      where,
      take,
      orderBy,
    }: {
      where: Row;
      take?: number;
      orderBy?: { effectiveAt: "asc" | "desc" };
    }) => {
      let rows = store.observations.filter((row) => matchesWhere(row, where));
      if (orderBy?.effectiveAt === "asc") {
        rows = [...rows].sort(
          (a, b) => (a.effectiveAt as Date).getTime() - (b.effectiveAt as Date).getTime(),
        );
      }
      if (orderBy?.effectiveAt === "desc") {
        rows = [...rows].sort(
          (a, b) => (b.effectiveAt as Date).getTime() - (a.effectiveAt as Date).getTime(),
        );
      }
      return take === undefined ? rows : rows.slice(0, take);
    },
    findFirst: async ({ where }: { where: Row }) =>
      store.observations.find((row) => matchesWhere(row, where)) ?? null,
    aggregate: async ({ where }: { where: Row }) => {
      const rows = store.observations.filter((row) => matchesWhere(row, where));
      const values = rows.map((row) => Number(row.value));
      const times = rows.map((row) => row.effectiveAt as Date);
      return {
        _count: { _all: rows.length },
        _min: {
          effectiveAt:
            times.length === 0
              ? null
              : new Date(Math.min(...times.map((t) => t.getTime()))),
          value: values.length === 0 ? null : Math.min(...values),
        },
        _max: {
          effectiveAt:
            times.length === 0
              ? null
              : new Date(Math.max(...times.map((t) => t.getTime()))),
          value: values.length === 0 ? null : Math.max(...values),
        },
        _avg: {
          value:
            values.length === 0
              ? null
              : values.reduce((sum, value) => sum + value, 0) / values.length,
        },
      };
    },
  },
  auditEvent: {
    findFirst: async () =>
      store.events.length === 0 ? null : store.events[store.events.length - 1],
    create: async ({ data }: { data: AuditRow }) => {
      store.events.push({ ...data });
      return data;
    },
  },
  $executeRaw: async () => 0,
  $transaction: async (fn: (tx: ReturnType<typeof mockDb>) => Promise<unknown>) =>
    fn(mockDb()),
});

const mockModuleForFile = moduleMocker({ mock, afterAll });
mock.module("server-only", () => ({}));
await mockModuleForFile("@/infrastructure/database", {
  database: () => mockDb(),
});

const synthetic = {
  actor: "local",
  sessionId: "turn-1",
  mode: "synthetic" as const,
};

beforeEach(() => {
  resetStore();
  seedPatient2();
});

describe("query tools against constructed patient-2", () => {
  test("list_subjects returns the patient-2 subject_ref", async () => {
    const { runListSubjects } = await import("./tools");
    const result = await runListSubjects(synthetic, { cohort_id: COHORT });
    expect(result).toEqual({ subjects: [{ subject_ref: SUBJECT }] });
  });

  test("subject_window is the single effective time and n=5", async () => {
    const { runSubjectWindow } = await import("./tools");
    const result = await runSubjectWindow(synthetic, { subject_ref: SUBJECT });
    expect(result).toEqual({
      start: EFFECTIVE.toISOString(),
      end: EFFECTIVE.toISOString(),
      n_observations: 5,
    });
  });

  test("observations_for_subject 8302-2 is 175.3 cm", async () => {
    const { runObservationsForSubject } = await import("./tools");
    const result = await runObservationsForSubject(synthetic, {
      subject_ref: SUBJECT,
      loinc: ["8302-2"],
      start: RANGE.start,
      end: RANGE.end,
      limit: 500,
    });
    expect(result).toEqual({
      rows: [
        {
          subject_ref: SUBJECT,
          loinc: "8302-2",
          display: "Body Height",
          value: 175.3,
          unit_ucum: "cm",
          effective_at: EFFECTIVE.toISOString(),
        },
      ],
    });
  });

  test("latest_by_loinc returns one row each for 8302-2 and 39156-5", async () => {
    const { runLatestByLoinc } = await import("./tools");
    const result = await runLatestByLoinc(synthetic, {
      subject_ref: SUBJECT,
      loinc: ["8302-2", "39156-5"],
    });
    expect(result).toEqual({
      rows: [
        {
          subject_ref: SUBJECT,
          loinc: "8302-2",
          display: "Body Height",
          value: 175.3,
          unit_ucum: "cm",
          effective_at: EFFECTIVE.toISOString(),
        },
        {
          subject_ref: SUBJECT,
          loinc: "39156-5",
          display: "Body mass index (BMI) [Ratio]",
          value: 27.72,
          unit_ucum: "kg/m2",
          effective_at: EFFECTIVE.toISOString(),
        },
      ],
      codes_without_rows: [],
    });
  });

  test("latest_by_loinc lists a code with no reading, and refuses when none has one", async () => {
    const { runLatestByLoinc } = await import("./tools");
    const some = await runLatestByLoinc(synthetic, {
      subject_ref: SUBJECT,
      loinc: ["8302-2", "88678-4"],
    });
    expect("rows" in some && some.codes_without_rows).toEqual(["88678-4"]);
    expect(
      await runLatestByLoinc(synthetic, { subject_ref: SUBJECT, loinc: ["88678-4"] }),
    ).toEqual({
      code: "NO_ROWS",
      error:
        "none of these LOINC codes has a reading for this subject; check each code is the one meant before saying there is no data",
      loinc: ["88678-4"],
    });
  });

  test("summary_stats for 29463-7 is n=1 min=max=mean=85.2 kg", async () => {
    const { runSummaryStats } = await import("./tools");
    const result = await runSummaryStats(synthetic, {
      subject_ref: SUBJECT,
      loinc: "29463-7",
      start: RANGE.start,
      end: RANGE.end,
    });
    expect(result).toEqual({
      n: 1,
      min: 85.2,
      max: 85.2,
      mean: 85.2,
      unit: "kg",
    });
  });

  test("summary_stats refuses 29463-7 in kg and [lb_av] instead of averaging them", async () => {
    store.observations.push({
      subjectRef: SUBJECT,
      loinc: "29463-7",
      display: "Body Weight",
      value: 187.8,
      unitUcum: "[lb_av]",
      effectiveAt: new Date("2018-02-11T04:29:26+01:00"),
    });
    const { runSummaryStats } = await import("./tools");
    const result = await runSummaryStats(synthetic, {
      subject_ref: SUBJECT,
      loinc: "29463-7",
      start: RANGE.start,
      end: RANGE.end,
    });
    expect(result).toEqual({
      code: "MIXED_UNITS",
      error: "observations for this code use more than one unit",
      loinc: "29463-7",
      units: ["[lb_av]", "kg"],
    });
    expect(store.events.map((event) => [event.tool, event.rowCount])).toEqual([
      ["summary_stats", 0],
    ]);
  });
});

describe("patient-2 oracles for 72514-3 and 59576-9", () => {
  test("observations_for_subject 72514-3 is 1 {score}", async () => {
    const { runObservationsForSubject } = await import("./tools");
    const result = await runObservationsForSubject(synthetic, {
      subject_ref: SUBJECT,
      loinc: ["72514-3"],
      start: RANGE.start,
      end: RANGE.end,
      limit: 500,
    });
    expect(result).toEqual({
      rows: [
        {
          subject_ref: SUBJECT,
          loinc: "72514-3",
          display: "Pain severity - 0-10 verbal numeric rating [Score] - Reported",
          value: 1,
          unit_ucum: "{score}",
          effective_at: EFFECTIVE.toISOString(),
        },
      ],
    });
  });

  test("latest_by_loinc 59576-9 is 92.377 %", async () => {
    const { runLatestByLoinc } = await import("./tools");
    const result = await runLatestByLoinc(synthetic, {
      subject_ref: SUBJECT,
      loinc: ["59576-9"],
    });
    expect(result).toEqual({
      rows: [
        {
          subject_ref: SUBJECT,
          loinc: "59576-9",
          display: "Body mass index (BMI) [Percentile] Per age and sex",
          value: 92.377,
          unit_ucum: "%",
          effective_at: EFFECTIVE.toISOString(),
        },
      ],
      codes_without_rows: [],
    });
  });
});

describe("subject scope", () => {
  test("personal mode is refused and audited with the refusal hash", async () => {
    const { runSubjectWindow } = await import("./tools");
    const result = await runSubjectWindow(
      { actor: "local", sessionId: "turn-scope", mode: "personal" },
      { subject_ref: SUBJECT },
    );
    expect(result).toEqual(SUBJECT_SCOPE_VIOLATION);
    expect(store.events).toHaveLength(1);
    expect(store.events[0].rowCount).toBe(0);
    expect(store.events[0].resultSha256).toBe(
      sha256Hex(toCanonicalJson(SUBJECT_SCOPE_VIOLATION)),
    );
  });

  test("a foreign subject_ref is refused and audited", async () => {
    const { runSubjectWindow } = await import("./tools");
    const result = await runSubjectWindow(synthetic, {
      subject_ref: "not-in-this-cohort",
    });
    expect(result).toEqual(SUBJECT_SCOPE_VIOLATION);
    expect(store.events).toHaveLength(1);
    expect(store.events[0].rowCount).toBe(0);
    expect(store.events[0].resultSha256).toBe(
      sha256Hex(toCanonicalJson(SUBJECT_SCOPE_VIOLATION)),
    );
  });

  test("a subject in the seeded cohort synthea-v4-seed42 is served", async () => {
    store.subjects.set(SEEDED_SUBJECT, {
      subjectRef: SEEDED_SUBJECT,
      isSynthetic: true,
      cohortId: "synthea-v4-seed42",
    });
    store.observations.push({
      subjectRef: SEEDED_SUBJECT,
      loinc: "8480-6",
      display: "Systolic Blood Pressure",
      value: 128,
      unitUcum: "mm[Hg]",
      effectiveAt: SEEDED_EFFECTIVE,
    });
    const { runListSubjects, runSummaryStats } = await import("./tools");
    expect(await runListSubjects(synthetic, { cohort_id: "synthea-v4-seed42" })).toEqual({
      subjects: [{ subject_ref: SEEDED_SUBJECT }],
    });
    expect(
      await runSummaryStats(synthetic, {
        subject_ref: SEEDED_SUBJECT,
        loinc: "8480-6",
        start: RANGE.start,
        end: RANGE.end,
      }),
    ).toEqual({ n: 1, min: 128, max: 128, mean: 128, unit: "mm[Hg]" });
  });

  test("a synthetic subject in a cohort outside the allowlist is refused", async () => {
    store.subjects.set("other-cohort-subject", {
      subjectRef: "other-cohort-subject",
      isSynthetic: true,
      cohortId: "synthea-unlisted",
    });
    const { runSubjectWindow } = await import("./tools");
    expect(
      await runSubjectWindow(synthetic, { subject_ref: "other-cohort-subject" }),
    ).toEqual(SUBJECT_SCOPE_VIOLATION);
  });

  test("a non-synthetic row in an allowed cohort is refused", async () => {
    store.subjects.set("not-synthetic", {
      subjectRef: "not-synthetic",
      isSynthetic: false,
      cohortId: "synthea-v4-seed42",
    });
    const { runSubjectWindow, runListSubjects } = await import("./tools");
    expect(await runSubjectWindow(synthetic, { subject_ref: "not-synthetic" })).toEqual(
      SUBJECT_SCOPE_VIOLATION,
    );
    expect(await runListSubjects(synthetic, { cohort_id: "synthea-v4-seed42" })).toEqual({
      subjects: [],
    });
  });

  test("list_subjects refuses a cohort outside the allowlist and personal mode", async () => {
    const { runListSubjects } = await import("./tools");
    expect(await runListSubjects(synthetic, { cohort_id: "synthea-unlisted" })).toEqual({
      code: "SUBJECT_SCOPE_VIOLATION",
      error: "cohort_id is not a cohort this session can read; use one listed in cohorts",
      cohorts: [COHORT],
    });
    expect(
      await runListSubjects(
        { actor: "local", sessionId: "turn-scope", mode: "personal" },
        { cohort_id: COHORT },
      ),
    ).toEqual({
      code: "SUBJECT_SCOPE_VIOLATION",
      error: "no cohort can be read in personal mode",
      cohorts: [],
    });
    expect(store.events.map((event) => event.rowCount)).toEqual([0, 0]);
  });
});
