import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type {
  ConditionRecord,
  MedicationRequestRecord,
} from "../../packages/query-tools/ports";

import { type CohortSubject, cohortSubjectFrom, memoryPorts } from "./cohort-ports";

const FIXTURES = join(import.meta.dir, "../../tests/fixtures/synthea");
const readBundle = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as unknown;

const COHORT = "synthea-v4-seed42";
const at = (iso: string) => new Date(iso);

const condition = (
  id: string,
  code: string,
  onset: string | null,
  abatement: string | null,
  status = "active",
): ConditionRecord => ({
  id,
  codeSystem: "http://snomed.info/sct",
  code,
  display: code,
  onsetAt: onset === null ? null : at(onset),
  abatementAt: abatement === null ? null : at(abatement),
  clinicalStatus: status,
  verificationStatus: null,
});

const request = (
  id: string,
  code: string,
  authored: string,
): MedicationRequestRecord => ({
  id,
  codeSystem: "rxnorm",
  code,
  display: code,
  authoredAt: at(authored),
  status: "active",
  intent: "order",
  dosageText: [],
});

const SUBJECT: CohortSubject = {
  subjectRef: "s1",
  scope: { isSynthetic: true, cohortId: COHORT },
  observations: [
    {
      id: "o2",
      loinc: "8867-4",
      value: 70,
      unitUcum: "/min",
      effectiveAt: at("2020-02-01T00:00:00Z"),
    },
    {
      id: "o1",
      loinc: "8867-4",
      value: 60,
      unitUcum: "/min",
      effectiveAt: at("2020-01-01T00:00:00Z"),
    },
    {
      id: "o3",
      loinc: "8480-6",
      value: 120,
      unitUcum: "mm[Hg]",
      effectiveAt: at("2020-03-01T00:00:00Z"),
    },
  ],
  conditions: [
    condition("c3", "b", "2019-01-01T00:00:00Z", null),
    condition("c2", "a", "2019-01-01T00:00:00Z", null),
    condition("c1", "z", "2010-01-01T00:00:00Z", "2015-01-01T00:00:00Z", "resolved"),
    condition("c4", "y", null, null),
  ],
  medicationRequests: [
    request("m2", "x", "2021-01-01T00:00:00Z"),
    request("m1", "x", "2018-01-01T00:00:00Z"),
  ],
};

describe("memoryPorts answers as the Prisma queries do", () => {
  const ports = memoryPorts([SUBJECT]);

  test("subjects: the scope row, null for an unknown ref", async () => {
    expect(await ports.findSubject("s1")).toEqual({
      isSynthetic: true,
      cohortId: COHORT,
    });
    expect(await ports.findSubject("nobody")).toBeNull();
  });

  test("observations: codes and the inclusive window, oldest first, at most take", async () => {
    const query = {
      subjectRef: "s1",
      loinc: ["8867-4"],
      start: at("2020-01-01T00:00:00Z"),
      end: at("2020-02-01T00:00:00Z"),
    };
    const rows = await ports.findObservations({ ...query, take: 10 });
    expect(rows.map((row) => row.id)).toEqual(["o1", "o2"]);
    const one = await ports.findObservations({ ...query, take: 1 });
    expect(one.map((row) => row.id)).toEqual(["o1"]);
  });

  test("conditions: the overlap rule, a code filter, ordered by onset, code, id", async () => {
    const all = await ports.findConditions?.({
      subjectRef: "s1",
      start: at("2014-01-01T00:00:00Z"),
      end: at("2025-01-01T00:00:00Z"),
      take: 10,
    });
    // c1 abates after the start, so it overlaps; c4 has no onset and is never listed.
    expect(all?.map((row) => row.id)).toEqual(["c1", "c2", "c3"]);
    const later = await ports.findConditions?.({
      subjectRef: "s1",
      start: at("2016-01-01T00:00:00Z"),
      end: at("2025-01-01T00:00:00Z"),
      code: "b",
      take: 10,
    });
    expect(later?.map((row) => row.id)).toEqual(["c3"]);
    const resolved = await ports.findConditions?.({
      subjectRef: "s1",
      start: at("2000-01-01T00:00:00Z"),
      end: at("2025-01-01T00:00:00Z"),
      status: "resolved",
      take: 10,
    });
    expect(resolved?.map((row) => row.id)).toEqual(["c1"]);
  });

  test("medication requests: authored in the window, oldest first", async () => {
    const rows = await ports.findMedicationRequests?.({
      subjectRef: "s1",
      start: at("2017-01-01T00:00:00Z"),
      end: at("2022-01-01T00:00:00Z"),
      take: 10,
    });
    expect(rows?.map((row) => row.id)).toEqual(["m1", "m2"]);
  });

  test("the observation span, null for a subject with none", async () => {
    expect(await ports.findObservationSpan?.("s1")).toEqual({
      first: at("2020-01-01T00:00:00Z"),
      last: at("2020-03-01T00:00:00Z"),
    });
    expect(await ports.findObservationSpan?.("nobody")).toBeNull();
  });

  test("cohort observations: one code across the cohort's synthetic subjects", async () => {
    const rows = await ports.findCohortObservations({
      cohortId: COHORT,
      loinc: "8867-4",
      start: at("2019-01-01T00:00:00Z"),
      end: at("2021-01-01T00:00:00Z"),
      take: 10,
    });
    expect(rows.map((row) => [row.subjectRef, row.value])).toEqual([
      ["s1", 60],
      ["s1", 70],
    ]);
  });

  test("audit rows stay in memory", async () => {
    const own = memoryPorts([SUBJECT]);
    await own.appendAudit({
      actor: "a",
      sessionId: "s",
      subjectRef: "s1",
      tool: "trend",
      args: {},
      result: {},
      rowCount: 0,
    });
    expect(own.audit.length).toBe(1);
  });
});

describe("cohortSubjectFrom maps a bundle as ingest does", () => {
  test("numeric observations, conditions and requests of a Synthea bundle", () => {
    const subject = cohortSubjectFrom(
      readBundle("clinical/clinical-records.json"),
      COHORT,
      "v4.0.0",
    );
    expect(subject?.subjectRef).toBe("c1000000-0000-4000-8000-000000000001");
    expect(subject?.scope).toMatchObject({ isSynthetic: true, cohortId: COHORT });
    expect(
      subject?.conditions.map((row) => [row.code, row.onsetAt?.toISOString()]),
    ).toEqual([
      ["444814009", "2015-04-02T09:00:00.000Z"],
      ["I10", "2018-11-05T10:00:00.000Z"],
    ]);
    expect(subject?.medicationRequests.length).toBe(2);
  });

  test("observation rows keep value, unit and time", () => {
    const subject = cohortSubjectFrom(readBundle("patient-1.json"), COHORT, "v4.0.0");
    expect(subject?.observations.length).toBeGreaterThan(0);
    expect(
      subject?.observations.every(
        (row) => typeof row.value === "number" && row.unitUcum.length > 0,
      ),
    ).toBe(true);
  });

  test("a bundle that is not Synthea's is left out, as ingest rejects it", () => {
    expect(
      cohortSubjectFrom({ resourceType: "Bundle", entry: [] }, COHORT, "v4.0.0"),
    ).toBeNull();
  });
});
