import { describe, expect, test } from "bun:test";

import { type AppendInput } from "@/packages/audit/append";
import { SUBJECT_SCOPE_VIOLATION } from "@/packages/query-tools/scope";

import { type CohortRow } from "../../biomarkers/cohort-handler";
import { DAY_FAILED, DAY_NOT_FOUND, DAY_REFUSED, DAY_SIGN_IN } from "./day-copy";
import {
  createDayHandler,
  createDayListHandler,
  createMockDayHandler,
  DAY_AUDIT_TOOL,
  DAY_LIST_AUDIT_TOOL,
  createPeriodHandler,
  PERIOD_AUDIT_TOOL,
  type DayDeps,
} from "./day-handler";
import { DAY_CODES, MOCK_DAY_REF } from "./demo-day";

const SUBJECTS: Readonly<Record<string, { isSynthetic: boolean; cohortId: string }>> = {
  "syn-a": { isSynthetic: true, cohortId: "synthea-v4-seed42" },
  "held-out": { isSynthetic: true, cohortId: "synthea-v4-seed9001" },
};

const ROWS: readonly CohortRow[] = [
  {
    id: "a",
    loinc: "8867-4",
    value: 64,
    unitUcum: "/min",
    effectiveAt: new Date("2026-11-15T12:00:00Z"),
  },
  {
    id: "b",
    loinc: "2339-0",
    value: 96,
    unitUcum: "mg/dL",
    effectiveAt: new Date("2026-11-15T12:00:00Z"),
  },
];

const fakeDeps = (overrides: Partial<DayDeps> = {}) => {
  const audits: AppendInput[] = [];
  const asked: string[] = [];
  const spans: (Readonly<{ from: Date; to: Date }> | undefined)[] = [];
  const deps: DayDeps = {
    resolveActorId: async () => "local",
    findSubject: async (ref) => SUBJECTS[ref] ?? null,
    findValues: async (ref, _codes, span) => {
      asked.push(ref);
      spans.push(span);
      return ROWS;
    },
    appendAudit: async (input) => {
      audits.push(input);
    },
    ...overrides,
  };
  return { deps, audits, asked, spans };
};

const context = (ref: string) => ({ params: Promise.resolve({ subjectRef: ref }) });

const getList = (deps: DayDeps, ref: string) =>
  createDayListHandler(deps)(
    new Request(`http://local/api/digital-twin/days/${ref}`),
    context(ref),
  );

const getDay = (deps: DayDeps, ref: string, query: string) =>
  createDayHandler(deps)(
    new Request(`http://local/api/digital-twin/day/${ref}?${query}`),
    context(ref),
  );

describe("GET /api/digital-twin/days/:subjectRef", () => {
  test("lists the Demo person's days in one audited read", async () => {
    const { deps, audits } = fakeDeps();
    const response = await getList(deps, "syn-a");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      days: [{ day: "2026-11-15", readings: 2 }],
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      tool: DAY_LIST_AUDIT_TOOL,
      subjectRef: "syn-a",
      args: { codes: DAY_CODES },
      rowCount: 2,
    });
  });

  test("a subject outside the Demo cohorts is not read, and is audited", async () => {
    const { deps, audits, asked } = fakeDeps();
    const response = await getList(deps, "held-out");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: DAY_NOT_FOUND });
    expect(asked).toEqual([]);
    expect(audits[0]).toMatchObject({ result: SUBJECT_SCOPE_VIOLATION, rowCount: 0 });
  });

  test("asks for sign-in without an actor, and reads nothing", async () => {
    const { deps, audits, asked } = fakeDeps({ resolveActorId: async () => null });
    const response = await getList(deps, "syn-a");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: DAY_SIGN_IN });
    expect(asked).toEqual([]);
    expect(audits).toEqual([]);
  });

  test("a failed read is audited and answered with a plain sentence", async () => {
    const { deps, audits } = fakeDeps({
      findValues: async () => {
        throw new Error("connection refused at 10.0.0.1");
      },
    });
    const response = await getList(deps, "syn-a");
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: DAY_FAILED });
    expect(audits[0]).toMatchObject({ result: { error: "failed" }, rowCount: 0 });
  });
});

describe("GET /api/digital-twin/day/:subjectRef", () => {
  test("returns the day as a kiosk day, audited with the rows read", async () => {
    const { deps, audits } = fakeDeps();
    const response = await getDay(deps, "syn-a", "day=2026-11-15&profile=with_diabetes");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { day: { profile: string; day: string } };
    expect(body.day).toMatchObject({ day: "2026-11-15", profile: "with_diabetes" });
    expect(audits[0]).toMatchObject({
      tool: DAY_AUDIT_TOOL,
      args: { codes: DAY_CODES, day: "2026-11-15", profile: "with_diabetes" },
      rowCount: 2,
    });
  });

  test("reads only the asked UTC day", async () => {
    const { deps, spans } = fakeDeps();
    await getDay(deps, "syn-a", "day=2026-11-15");
    expect(spans).toEqual([
      {
        from: new Date("2026-11-15T00:00:00.000Z"),
        to: new Date("2026-11-15T23:59:59.999Z"),
      },
    ]);
  });

  test("a day without readings is refused with a sentence and audited with 0 rows", async () => {
    const { deps, audits } = fakeDeps();
    const response = await getDay(deps, "syn-a", "day=2026-11-01");
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: DAY_REFUSED["no-readings"] });
    expect(audits[0]).toMatchObject({ result: { refused: "no-readings" }, rowCount: 0 });
  });

  test("a bad day or profile is refused before any read", async () => {
    const { deps, audits, asked } = fakeDeps();
    expect((await getDay(deps, "syn-a", "day=yesterday")).status).toBe(400);
    expect((await getDay(deps, "syn-a", "day=2026-02-30")).status).toBe(400);
    expect((await getDay(deps, "syn-a", "day=2026-11-15&profile=x")).status).toBe(400);
    expect(asked).toEqual([]);
    expect(audits).toEqual([]);
  });

  test("a subject outside the Demo cohorts gets no day", async () => {
    const { deps, asked } = fakeDeps();
    const response = await getDay(deps, "held-out", "day=2026-11-15");
    expect(response.status).toBe(404);
    expect(asked).toEqual([]);
  });
});

describe("GET /api/digital-twin/day", () => {
  test("returns the illustrative mock day without reading a subject", async () => {
    const response = await createMockDayHandler({ resolveActorId: async () => "local" })(
      new Request("http://local/api/digital-twin/day?profile=without_diabetes"),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { day: { subject_ref: string } };
    expect(body.day.subject_ref).toBe(MOCK_DAY_REF);
  });

  test("asks for sign-in without an actor", async () => {
    const response = await createMockDayHandler({ resolveActorId: async () => null })(
      new Request("http://local/api/digital-twin/day"),
    );
    expect(response.status).toBe(401);
  });
});

const getPeriod = (deps: DayDeps, ref: string, query: string) =>
  createPeriodHandler(deps)(
    new Request(`http://local/api/digital-twin/period/${ref}?${query}`),
    context(ref),
  );

describe("GET /api/digital-twin/period/:subjectRef", () => {
  test("returns the summary lines, audited with the rows read", async () => {
    const { deps, audits } = fakeDeps();
    const response = await getPeriod(deps, "syn-a", "period=week&end=2026-11-16");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      period: { start: string; lines: unknown[] };
    };
    expect(body.period.start).toBe("2026-11-10");
    expect(body.period.lines).toHaveLength(4);
    expect(audits[0]).toMatchObject({
      tool: PERIOD_AUDIT_TOOL,
      args: { period: "week", end: "2026-11-16", profile: "without_diabetes" },
      rowCount: 1,
    });
  });

  test("reads the week and the 35 days its trends compare, no more", async () => {
    const { deps, spans } = fakeDeps();
    await getPeriod(deps, "syn-a", "period=week&end=2026-11-16");
    expect(spans).toEqual([
      {
        from: new Date("2026-10-13T00:00:00.000Z"),
        to: new Date("2026-11-16T23:59:59.999Z"),
      },
    ]);
  });

  test("a bad period or end is refused before any read", async () => {
    const { deps, asked } = fakeDeps();
    expect((await getPeriod(deps, "syn-a", "period=year&end=2026-11-16")).status).toBe(
      400,
    );
    expect((await getPeriod(deps, "syn-a", "period=week")).status).toBe(400);
    expect(asked).toEqual([]);
  });

  test("a subject outside the Demo cohorts gets no period", async () => {
    const { deps, asked } = fakeDeps();
    expect((await getPeriod(deps, "held-out", "period=week&end=2026-11-16")).status).toBe(
      404,
    );
    expect(asked).toEqual([]);
  });
});
