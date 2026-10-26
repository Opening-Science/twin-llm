import { describe, expect, test } from "bun:test";

import { type AppendInput } from "@/packages/audit/append";

import {
  type ExplorerDeps,
  loadCohorts,
  loadOverview,
  loadSubject,
  loadSubjects,
  OVERVIEW_AUDIT_TOOL,
  pickCohort,
  SUBJECT_AUDIT_TOOL,
  SUBJECTS_AUDIT_TOOL,
} from "./explorer-reads";

type Fake = ExplorerDeps & { readonly audits: AppendInput[]; readonly reads: string[] };

const fake = (overrides: Partial<ExplorerDeps> = {}): Fake => {
  const audits: AppendInput[] = [];
  const reads: string[] = [];
  const read =
    <A extends unknown[], R>(name: string, value: (...args: A) => R) =>
    async (...args: A) => {
      reads.push(name);
      return value(...args);
    };
  return {
    audits,
    reads,
    resolveActorId: async () => "local",
    listCohorts: read("listCohorts", () => [
      { cohortId: "synthea-v4-seed4242", subjects: 3 },
      { cohortId: "someone-elses-cohort", subjects: 9 },
      { cohortId: "synthea-v4-seed42", subjects: 2 },
      { cohortId: "synthea-v4-seed9001", subjects: 0 },
    ]),
    readAggregates: read("readAggregates", () => ({
      subjects: 2,
      nonNumeric: 5,
      codeUnits: [
        {
          loinc: "29463-7",
          display: "Body weight",
          unit: "kg",
          rows: 6,
          subjects: 2,
          first: new Date("2019-04-01T00:00:00Z"),
          last: new Date("2021-02-01T00:00:00Z"),
        },
        {
          loinc: "4548-4",
          display: "HbA1c",
          unit: "%",
          rows: 1,
          subjects: 1,
          first: new Date("2020-06-01T00:00:00Z"),
          last: new Date("2020-06-01T00:00:00Z"),
        },
      ],
      codeSubjects: [
        { loinc: "29463-7", subjects: 2 },
        { loinc: "4548-4", subjects: 1 },
      ],
      years: [
        { year: 2019, rows: 2, subjects: 2 },
        { year: 2021, rows: 3, subjects: 2 },
      ],
    })),
    listSubjectSummaries: read("listSubjectSummaries", () => [
      {
        ref: "s-1",
        observations: 4,
        codes: 2,
        firstDay: "2019-04-01",
        lastDay: "2021-02-01",
      },
      {
        ref: "s-2",
        observations: 3,
        codes: 1,
        firstDay: "2019-05-01",
        lastDay: "2020-02-01",
      },
    ]),
    findSubject: read("findSubject", (ref: string) =>
      ref === "s-1"
        ? { isSynthetic: true, cohortId: "synthea-v4-seed42" }
        : ref === "not-synthetic"
          ? { isSynthetic: false, cohortId: "synthea-v4-seed42" }
          : null,
    ),
    findSubjectObservations: read("findSubjectObservations", () => [
      {
        id: "o1",
        loinc: "29463-7",
        display: "Body weight",
        value: 80.5,
        unit: "kg",
        effectiveAt: new Date("2019-04-01T09:00:00Z"),
      },
      {
        id: "o2",
        loinc: "29463-7",
        display: "Body weight",
        value: 81,
        unit: "kg",
        effectiveAt: new Date("2021-02-01T09:00:00Z"),
      },
    ]),
    countSubjectNonNumeric: read("countSubjectNonNumeric", () => 3),
    subjectRowCap: 50_000,
    appendAudit: async (input) => {
      audits.push(input);
    },
    ...overrides,
  };
};

const quietly = async <T>(run: () => Promise<T>): Promise<[T, unknown[][]]> => {
  const original = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => void logged.push(args);
  try {
    return [await run(), logged];
  } finally {
    console.error = original;
  }
};

describe("sign-in and the synthetic display scope", () => {
  test("a non-synthetic subject is not found, audited, and its rows never read", async () => {
    const deps = fake();
    expect(await loadSubject(deps, "not-synthetic")).toEqual({ kind: "not-found" });
    expect(deps.reads).toEqual(["findSubject"]);
    expect(deps.audits.map((audit) => [audit.subjectRef, audit.rowCount])).toEqual([
      ["not-synthetic", 0],
    ]);
  });

  test("a synthetic subject outside the allowlist is not found either", async () => {
    const deps = fake({
      findSubject: async () => ({ isSynthetic: true, cohortId: "someone-elses-cohort" }),
    });
    expect(await loadSubject(deps, "s-9")).toEqual({ kind: "not-found" });
  });

  test("no actor means sign in, before any read", async () => {
    const deps = fake({ resolveActorId: async () => null });
    expect(await loadSubject(deps, "s-1")).toEqual({ kind: "sign-in" });
    expect(deps.reads).toEqual([]);
  });
});

describe("cohorts", () => {
  test("only allowlisted cohorts with subjects, in allowlist order", async () => {
    expect(await loadCohorts(fake())).toEqual({
      kind: "ok",
      cohorts: [
        { cohortId: "synthea-v4-seed42", subjects: 2 },
        { cohortId: "synthea-v4-seed4242", subjects: 3 },
      ],
    });
  });

  test("the URL's cohort when listed, else the first, else none", () => {
    const cohorts = [
      { cohortId: "synthea-v4-seed42", subjects: 2 },
      { cohortId: "synthea-v4-seed4242", subjects: 3 },
    ];
    expect(pickCohort(cohorts, "synthea-v4-seed4242")?.cohortId).toBe(
      "synthea-v4-seed4242",
    );
    expect(pickCohort(cohorts, "someone-elses-cohort")?.cohortId).toBe(
      "synthea-v4-seed42",
    );
    expect(pickCohort([], undefined)).toBeNull();
  });
});

describe("overview", () => {
  test("summarises the cohort and writes one audit row with no subject", async () => {
    const deps = fake();
    const result = await loadOverview(deps, "synthea-v4-seed42");
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.overview.totals).toEqual({
      subjects: 2,
      observations: 7,
      nonNumeric: 5,
      codes: 2,
      firstDay: "2019-04-01",
      lastDay: "2021-02-01",
    });
    expect(result.overview.codes.map((code) => [code.loinc, code.share])).toEqual([
      ["29463-7", 1],
      ["4548-4", 0.5],
    ]);
    expect(result.overview.years.map((year) => [year.year, year.rows])).toEqual([
      [2019, 2],
      [2020, 0],
      [2021, 3],
    ]);
    expect(deps.audits).toHaveLength(1);
    expect(deps.audits[0]).toMatchObject({
      actor: "local",
      sessionId: "local",
      subjectRef: null,
      tool: OVERVIEW_AUDIT_TOOL,
      args: { cohort_id: "synthea-v4-seed42" },
      rowCount: 7,
    });
  });

  test("a cohort off the allowlist is not found, audited as a refusal, and not read", async () => {
    const deps = fake();
    expect(await loadOverview(deps, "someone-elses-cohort")).toEqual({
      kind: "not-found",
    });
    expect(await loadSubjects(deps, "someone-elses-cohort")).toEqual({
      kind: "not-found",
    });
    expect(deps.reads).toEqual([]);
    const violation = {
      code: "SUBJECT_SCOPE_VIOLATION",
      error: "subject_ref is not in this session scope",
    };
    expect(
      deps.audits.map((audit) => [
        audit.tool,
        audit.subjectRef,
        audit.args,
        audit.result,
        audit.rowCount,
      ]),
    ).toEqual([
      [OVERVIEW_AUDIT_TOOL, null, { cohort_id: "someone-elses-cohort" }, violation, 0],
      [SUBJECTS_AUDIT_TOOL, null, { cohort_id: "someone-elses-cohort" }, violation, 0],
    ]);
  });

  test("a failed read is audited with no message and logged by name only", async () => {
    const deps = fake({
      readAggregates: async () => {
        throw new TypeError('relation "observations" does not exist at 127.0.0.1:5432');
      },
    });
    const [result, logged] = await quietly(() => loadOverview(deps, "synthea-v4-seed42"));
    expect(result).toEqual({ kind: "failed" });
    expect(logged).toEqual([["[data-explorer] overview failed", "TypeError"]]);
    expect(deps.audits.map((audit) => [audit.result, audit.rowCount])).toEqual([
      [{ error: "failed" }, 0],
    ]);
  });
});

describe("subjects", () => {
  test("lists the cohort's subjects and audits the count", async () => {
    const deps = fake();
    const result = await loadSubjects(deps, "synthea-v4-seed42");
    expect(result.kind === "ok" && result.subjects.map((s) => s.ref)).toEqual([
      "s-1",
      "s-2",
    ]);
    expect(
      deps.audits.map((audit) => [audit.tool, audit.subjectRef, audit.rowCount]),
    ).toEqual([[SUBJECTS_AUDIT_TOOL, null, 2]]);
  });
});

describe("one subject", () => {
  test("reads the series and audits the subject with the rows read", async () => {
    const deps = fake();
    const result = await loadSubject(deps, "s-1");
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.subject.cohortId).toBe("synthea-v4-seed42");
    expect(result.subject.nonNumeric).toBe(3);
    expect(result.subject.series.map((s) => [s.key, s.readings, s.latest.value])).toEqual(
      [["29463-7|kg", 2, 81]],
    );
    expect(
      deps.audits.map((audit) => [audit.tool, audit.subjectRef, audit.rowCount]),
    ).toEqual([[SUBJECT_AUDIT_TOOL, "s-1", 2]]);
  });

  test("an unknown or non-synthetic subject is a scope violation, audited, and not read", async () => {
    for (const ref of ["nobody", "not-synthetic"]) {
      const deps = fake();
      expect(await loadSubject(deps, ref)).toEqual({ kind: "not-found" });
      expect(deps.reads).toEqual(["findSubject"]);
      expect(
        deps.audits.map((audit) => [audit.subjectRef, audit.result, audit.rowCount]),
      ).toEqual([
        [
          ref,
          {
            code: "SUBJECT_SCOPE_VIOLATION",
            error: "subject_ref is not in this session scope",
          },
          0,
        ],
      ]);
    }
  });

  test("a subject of a cohort off the allowlist is out of scope", async () => {
    const deps = fake({
      findSubject: async () => ({ isSynthetic: true, cohortId: "someone-elses-cohort" }),
    });
    expect(await loadSubject(deps, "s-9")).toEqual({ kind: "not-found" });
    expect(deps.reads).toEqual([]);
  });
});

describe("row cap", () => {
  test("asks for one row over the cap and refuses a subject over it, audited with 0 rows", async () => {
    const takes: number[] = [];
    const rows = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `o${i}`,
        loinc: "8867-4",
        display: "Heart rate",
        value: 60 + i,
        unit: "/min",
        effectiveAt: new Date(Date.UTC(2020, 0, 1 + i)),
      }));
    const over = fake({
      subjectRowCap: 3,
      findSubjectObservations: async (_ref, take) => {
        takes.push(take);
        return rows(take);
      },
    });
    expect(await loadSubject(over, "s-1")).toEqual({ kind: "too-large" });
    expect(takes).toEqual([4]);
    expect(
      over.audits.map((audit) => [
        audit.tool,
        audit.subjectRef,
        audit.result,
        audit.rowCount,
      ]),
    ).toEqual([[SUBJECT_AUDIT_TOOL, "s-1", { code: "ROW_CAP_EXCEEDED", cap: 3 }, 0]]);

    const exact = fake({
      subjectRowCap: 3,
      findSubjectObservations: async () => rows(3),
    });
    const result = await loadSubject(exact, "s-1");
    expect(result.kind === "ok" && result.subject.series[0]!.latest.value).toBe(62);
    expect(exact.audits.map((audit) => audit.rowCount)).toEqual([3]);
  });
});
