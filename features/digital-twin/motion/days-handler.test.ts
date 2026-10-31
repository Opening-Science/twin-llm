import { describe, expect, test } from "bun:test";

import { type AppendInput } from "@/packages/audit/append";
import { SUBJECT_SCOPE_VIOLATION } from "@/packages/query-tools/scope";

import { type CohortRow } from "../biomarkers/cohort-handler";
import {
  createMotionDaysHandler,
  MOTION_DAYS_AUDIT_TOOL,
  type MotionDaysDeps,
} from "./days-handler";
import {
  MOTION_DAYS_FAILED,
  MOTION_DAYS_NOT_FOUND,
  MOTION_DAYS_SIGN_IN,
} from "./motion-copy";
import { MOTION_DAY_CODES } from "./motion-days";

const SUBJECTS: Readonly<Record<string, { isSynthetic: boolean; cohortId: string }>> = {
  "syn-a": { isSynthetic: true, cohortId: "synthea-v4-seed42" },
  "other-cohort": { isSynthetic: true, cohortId: "somewhere-else" },
};

const ROWS: readonly CohortRow[] = [
  {
    id: "obs-1",
    loinc: "93832-4",
    value: 402,
    unitUcum: "min",
    effectiveAt: new Date("2026-09-28T07:00:00Z"),
  },
  {
    id: "obs-2",
    loinc: "9279-1",
    value: 14.2,
    unitUcum: "/min",
    effectiveAt: new Date("2026-09-28T07:00:00Z"),
  },
  {
    id: "obs-3",
    loinc: "workout-running",
    value: 42,
    unitUcum: "min",
    effectiveAt: new Date("2026-09-28T18:00:00Z"),
  },
];

const DAYS = [
  {
    day: "2026-09-28",
    workout: { sport: "running", minutes: 42, distanceM: null, cadence: null },
    breathsPerMinute: 14.2,
  },
];

const fakeDeps = (overrides: Partial<MotionDaysDeps> = {}) => {
  const audits: AppendInput[] = [];
  const asked: { ref: string; codes: readonly string[] }[] = [];
  const deps: MotionDaysDeps = {
    resolveActorId: async () => "local",
    findSubject: async (ref) => SUBJECTS[ref] ?? null,
    findValues: async (ref, codes) => {
      asked.push({ ref, codes });
      return ROWS;
    },
    appendAudit: async (input) => {
      audits.push(input);
    },
    ...overrides,
  };
  return { deps, audits, asked };
};

const getDays = (deps: MotionDaysDeps, ref: string) =>
  createMotionDaysHandler(deps)(new Request(`http://local/api/motion/days/${ref}`), {
    params: Promise.resolve({ subjectRef: ref }),
  });

describe("GET /api/motion/days/:subjectRef", () => {
  test("returns the person's wearable days in one audited read", async () => {
    const { deps, audits, asked } = fakeDeps();
    const res = await getDays(deps, "syn-a");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ days: DAYS });
    expect(asked).toEqual([{ ref: "syn-a", codes: MOTION_DAY_CODES }]);
    expect(audits).toEqual([
      {
        actor: "local",
        sessionId: "local",
        subjectRef: "syn-a",
        tool: MOTION_DAYS_AUDIT_TOOL,
        args: { codes: MOTION_DAY_CODES },
        result: { days: DAYS },
        rowCount: 1,
      },
    ]);
  });

  test("asks to sign in without an actor", async () => {
    const { deps, audits } = fakeDeps({ resolveActorId: async () => null });
    const res = await getDays(deps, "syn-a");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: MOTION_DAYS_SIGN_IN });
    expect(audits).toEqual([]);
  });

  test("a subject outside the Demo cohorts is not found, and the refusal is audited", async () => {
    const { deps, audits, asked } = fakeDeps();
    const res = await getDays(deps, "other-cohort");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: MOTION_DAYS_NOT_FOUND });
    expect(asked).toEqual([]);
    expect(audits.map((row) => [row.tool, row.result, row.rowCount])).toEqual([
      [MOTION_DAYS_AUDIT_TOOL, SUBJECT_SCOPE_VIOLATION, 0],
    ]);
  });

  test("says a plain sentence when the database fails, and still audits the read", async () => {
    const { deps, audits } = fakeDeps({
      findValues: async () => {
        throw new Error("connection refused at 10.0.0.1");
      },
    });
    const original = console.error;
    console.error = () => undefined;
    const res = await getDays(deps, "syn-a").finally(() => {
      console.error = original;
    });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: MOTION_DAYS_FAILED });
    expect(audits.map((row) => [row.result, row.rowCount])).toEqual([
      [{ error: "failed" }, 0],
    ]);
  });
});
