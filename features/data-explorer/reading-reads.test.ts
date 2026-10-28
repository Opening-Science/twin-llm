import { describe, expect, test } from "bun:test";

import { type AppendInput } from "@/packages/audit/append";
import { SUBJECT_SCOPE_VIOLATION } from "@/packages/query-tools/scope";

import {
  loadReadingCounts,
  READINGS_AUDIT_TOOL,
  type ReadingDeps,
} from "./reading-reads";

type Fake = ReadingDeps & {
  readonly audits: AppendInput[];
  readonly takes: number[];
};

const COUNTS = [
  { subjectRef: "s-a", readings: 120 },
  { subjectRef: "s-b", readings: 30 },
  { subjectRef: "s-c", readings: 7 },
];

const fake = (overrides: Partial<ReadingDeps> = {}): Fake => {
  const audits: AppendInput[] = [];
  const takes: number[] = [];
  return {
    audits,
    takes,
    resolveActorId: async () => "local",
    readSubjectReadingCounts: async (_cohortId, take) => {
      takes.push(take);
      return COUNTS.slice(0, take);
    },
    subjectCap: 3,
    appendAudit: async (input) => {
      audits.push(input);
    },
    ...overrides,
  };
};

describe("loadReadingCounts", () => {
  test("reads one row past the cap and audits the subjects and readings counted", async () => {
    const deps = fake();
    expect(await loadReadingCounts(deps, "synthea-v4-seed42")).toEqual({
      kind: "ok",
      counts: COUNTS,
    });
    expect(deps.takes).toEqual([4]);
    expect(deps.audits).toEqual([
      {
        actor: "local",
        sessionId: "local",
        subjectRef: null,
        tool: READINGS_AUDIT_TOOL,
        args: { cohort_id: "synthea-v4-seed42" },
        result: { subjects: 3, readings: 157 },
        rowCount: 157,
      },
    ]);
  });

  test("a cohort over the cap is refused, not cut", async () => {
    const deps = fake({ subjectCap: 2 });
    expect(await loadReadingCounts(deps, "synthea-v4-seed42")).toEqual({
      kind: "too-large",
    });
    expect(deps.audits.map((audit) => [audit.result, audit.rowCount])).toEqual([
      [{ code: "ROW_CAP_EXCEEDED", cap: 2 }, 0],
    ]);
  });

  test("a cohort off the allowlist is audited as a scope violation and never read", async () => {
    const deps = fake();
    expect(await loadReadingCounts(deps, "someone-elses-cohort")).toEqual({
      kind: "not-found",
    });
    expect(deps.takes).toEqual([]);
    expect(deps.audits.map((audit) => [audit.result, audit.rowCount])).toEqual([
      [SUBJECT_SCOPE_VIOLATION, 0],
    ]);
  });

  test("no actor, no read and no audit row", async () => {
    const deps = fake({ resolveActorId: async () => null });
    expect(await loadReadingCounts(deps, "synthea-v4-seed42")).toEqual({
      kind: "sign-in",
    });
    expect(deps.takes).toEqual([]);
    expect(deps.audits).toEqual([]);
  });

  test("a failed read is audited without the error and shown as failed", async () => {
    const deps = fake({
      readSubjectReadingCounts: async () => {
        throw new Error("connection refused at db.internal:5432");
      },
    });
    const errors: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      expect(await loadReadingCounts(deps, "synthea-v4-seed42")).toEqual({
        kind: "failed",
      });
    } finally {
      console.error = original;
    }
    expect(errors).toEqual([["[data-explorer] readings per subject failed", "Error"]]);
    expect(deps.audits.map((audit) => [audit.result, audit.rowCount])).toEqual([
      [{ error: "failed" }, 0],
    ]);
  });
});
