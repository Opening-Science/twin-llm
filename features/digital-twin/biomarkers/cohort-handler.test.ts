import { describe, expect, test } from "bun:test";

import { type AppendInput } from "@/packages/audit/append";
import { SUBJECT_SCOPE_VIOLATION } from "@/packages/query-tools/scope";

import { COHORT_FAILED } from "./biomarker-copy";
import {
  COHORT_LIST_AUDIT_TOOL,
  COHORT_NOT_FOUND,
  COHORT_SIGN_IN,
  COHORT_VALUES_AUDIT_TOOL,
  createCohortListHandler,
  createCohortValuesHandler,
  type CohortDeps,
  type CohortRow,
} from "./cohort-handler";

const SUBJECTS: Readonly<Record<string, { isSynthetic: boolean; cohortId: string }>> = {
  "syn-a": { isSynthetic: true, cohortId: "synthea-v4-seed42" },
  "syn-b": { isSynthetic: true, cohortId: "synthea-v4-seed42" },
  "other-cohort": { isSynthetic: true, cohortId: "somewhere-else" },
};

const ROWS: readonly CohortRow[] = [
  {
    id: "obs-1",
    loinc: "4548-4",
    value: 6.1,
    unitUcum: "%",
    effectiveAt: new Date("2025-03-01T08:00:00Z"),
  },
  {
    id: "obs-2",
    loinc: "2571-8",
    value: 150,
    unitUcum: "mg/dL",
    effectiveAt: new Date("2024-11-20T08:00:00Z"),
  },
  {
    id: "obs-3",
    loinc: "8867-4",
    value: 72,
    unitUcum: "/min",
    effectiveAt: new Date("2025-03-01T08:00:00Z"),
  },
  {
    id: "obs-4",
    loinc: "8867-4",
    value: 80,
    unitUcum: "/min",
    effectiveAt: new Date("2024-01-10T08:00:00Z"),
  },
  {
    id: "obs-5",
    loinc: "9279-1",
    value: 14,
    unitUcum: "/min",
    effectiveAt: new Date("2025-03-01T08:00:00Z"),
  },
];

const fakeDeps = (overrides: Partial<CohortDeps> = {}) => {
  const audits: AppendInput[] = [];
  const asked: { ref: string; loincs: readonly string[] }[] = [];
  const deps: CohortDeps = {
    resolveActorId: async () => "local",
    listSubjects: async () => [
      { ref: "syn-a", sex: "female" },
      { ref: "syn-b", sex: "unknown" },
      { ref: "syn-c", sex: null },
    ],
    findSubject: async (ref) => SUBJECTS[ref] ?? null,
    findValues: async (ref, loincs) => {
      asked.push({ ref, loincs });
      return ROWS;
    },
    afOnDay: async (ref, day) => ref === "syn-b" && day === "2025-03-01",
    anchorLoincs: () => ["4548-4", "2571-8"],
    appendAudit: async (input) => {
      audits.push(input);
    },
    ...overrides,
  };
  return { deps, audits, asked };
};

const getValues = (deps: CohortDeps, ref: string) =>
  createCohortValuesHandler(deps)(
    new Request(`http://local/api/biomarkers/cohort/${ref}`),
    { params: Promise.resolve({ subjectRef: ref }) },
  );

describe("GET /api/biomarkers/cohort", () => {
  test("numbers the synthetic people in order, with female or male sex, and audits the read", async () => {
    const { deps, audits } = fakeDeps();
    const res = await createCohortListHandler(deps)();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const people = [
      { ref: "syn-a", label: "Synthetic person 1", sex: "female" },
      { ref: "syn-b", label: "Synthetic person 2", sex: null },
      { ref: "syn-c", label: "Synthetic person 3", sex: null },
    ];
    expect(await res.json()).toEqual({ subjects: people });
    expect(audits).toEqual([
      {
        actor: "local",
        sessionId: "local",
        subjectRef: null,
        tool: COHORT_LIST_AUDIT_TOOL,
        args: {},
        result: people,
        rowCount: 3,
      },
    ]);
  });

  test("asks to sign in without an actor", async () => {
    const { deps } = fakeDeps({ resolveActorId: async () => null });
    const res = await createCohortListHandler(deps)();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: COHORT_SIGN_IN });
  });

  test("says a plain sentence when the database fails", async () => {
    const { deps, audits } = fakeDeps({
      listSubjects: async () => {
        throw new Error("connection refused at 10.0.0.1");
      },
    });
    const res = await createCohortListHandler(deps)();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: COHORT_FAILED });
    expect(audits).toEqual([]);
  });
});

describe("GET /api/biomarkers/cohort/:subjectRef", () => {
  test("returns the newest value per Anchor LOINC and per vital, in one audited read", async () => {
    const { deps, audits, asked } = fakeDeps();
    const res = await getValues(deps, "syn-b");
    expect(res.status).toBe(200);
    const values = [
      {
        loinc: "4548-4",
        value: 6.1,
        unitUcum: "%",
        effectiveAt: "2025-03-01T08:00:00.000Z",
      },
      {
        loinc: "2571-8",
        value: 150,
        unitUcum: "mg/dL",
        effectiveAt: "2024-11-20T08:00:00.000Z",
      },
    ];
    const vitals = [
      {
        loinc: "8867-4",
        value: 72,
        unitUcum: "/min",
        effectiveAt: "2025-03-01T08:00:00.000Z",
      },
      {
        loinc: "9279-1",
        value: 14,
        unitUcum: "/min",
        effectiveAt: "2025-03-01T08:00:00.000Z",
      },
    ];
    const rhythm = { day: "2025-03-01", afOnDay: true };
    expect(await res.json()).toEqual({ values, vitals, rhythm });
    expect(asked).toEqual([
      { ref: "syn-b", loincs: ["4548-4", "2571-8", "8867-4", "9279-1"] },
    ]);
    expect(
      audits.map((row) => [row.tool, row.subjectRef, row.result, row.rowCount]),
    ).toEqual([[COHORT_VALUES_AUDIT_TOOL, "syn-b", { values, vitals, rhythm }, 4]]);
  });

  test("a vital code Anchor also lists is asked for once and returned in both", async () => {
    const { deps, asked } = fakeDeps({ anchorLoincs: () => ["8867-4"] });
    const body = (await (await getValues(deps, "syn-a")).json()) as {
      values: readonly { loinc: string }[];
      vitals: readonly { loinc: string }[];
    };
    expect(asked.map((call) => call.loincs)).toEqual([["8867-4", "9279-1"]]);
    expect(body.values.map((row) => row.loinc)).toEqual(["8867-4"]);
    expect(body.vitals.map((row) => row.loinc)).toEqual(["8867-4", "9279-1"]);
  });

  test("the newest row per LOINC wins; a tie on the timestamp goes to the lower id", async () => {
    const at = (iso: string) => new Date(iso);
    const tied: readonly CohortRow[] = [
      {
        id: "obs-b",
        loinc: "2571-8",
        value: 131,
        unitUcum: "mg/dL",
        effectiveAt: at("2024-11-20T08:00:00Z"),
      },
      {
        id: "obs-c",
        loinc: "2571-8",
        value: 90,
        unitUcum: "mg/dL",
        effectiveAt: at("2023-01-05T08:00:00Z"),
      },
      {
        id: "obs-a",
        loinc: "2571-8",
        value: 124.39,
        unitUcum: "mg/dL",
        effectiveAt: at("2024-11-20T08:00:00Z"),
      },
      {
        id: "obs-d",
        loinc: "4548-4",
        value: 5.9,
        unitUcum: "%",
        effectiveAt: at("2022-02-02T08:00:00Z"),
      },
    ];
    // Any order the database returns them in gives the same answer.
    for (const rows of [tied, [...tied].reverse()]) {
      const { deps } = fakeDeps({ findValues: async () => rows });
      const body = (await (await getValues(deps, "syn-a")).json()) as {
        values: readonly { loinc: string; value: number }[];
      };
      expect(body.values.map(({ loinc, value }) => [loinc, value])).toEqual([
        ["2571-8", 124.39],
        ["4548-4", 5.9],
      ]);
    }
  });

  test("refuses a subject outside the allowlisted cohorts and audits the refusal", async () => {
    const { deps, audits, asked } = fakeDeps();
    const res = await getValues(deps, "other-cohort");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: COHORT_NOT_FOUND });
    expect(asked).toEqual([]);
    expect(audits.map((row) => [row.subjectRef, row.result, row.rowCount])).toEqual([
      ["other-cohort", SUBJECT_SCOPE_VIOLATION, 0],
    ]);
  });

  test("refuses an unknown subject the same way", async () => {
    const { deps, audits } = fakeDeps();
    const res = await getValues(deps, "nobody");
    expect(res.status).toBe(404);
    expect(audits.map((row) => row.result)).toEqual([SUBJECT_SCOPE_VIOLATION]);
  });

  test("refuses a non-synthetic subject before reading its values", async () => {
    let read = false;
    const { deps, audits } = fakeDeps({
      findSubject: async () => ({ isSynthetic: false, cohortId: "synthea-v4-seed42" }),
      findValues: async () => {
        read = true;
        return [];
      },
    });
    const res = await getValues(deps, "syn-a");
    expect(res.status).toBe(404);
    expect(read).toBe(false);
    expect(audits.map((row) => row.result)).toEqual([SUBJECT_SCOPE_VIOLATION]);
  });

  test("audits a failed read with no rows and answers with a sentence", async () => {
    const { deps, audits } = fakeDeps({
      findValues: async () => {
        throw new Error("decimal out of range");
      },
    });
    const res = await getValues(deps, "syn-a");
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: COHORT_FAILED });
    expect(audits.map((row) => [row.subjectRef, row.result, row.rowCount])).toEqual([
      ["syn-a", { error: "failed" }, 0],
    ]);
  });
});
