import { describe, expect, test } from "bun:test";

import type { AppendInput } from "@/packages/audit/append";

import type {
  ObservationQuery,
  ObservationRecord,
  QueryToolPorts,
  SubjectScopeRow,
} from "./ports";
import { mixedUnits, ROW_CAP_EXCEEDED } from "./refusals";
import {
  baselineDeviationInput,
  compareWindowsInput,
  coverageInput,
  trendInput,
} from "./schemas";
import { SUBJECT_SCOPE_VIOLATION, type SessionScope } from "./scope";
import {
  QUERY_TOOL_FAILED,
  runBaselineDeviation,
  runCompareWindows,
  runCoverage,
  runTrend,
} from "./tools";

const SUBJECT = "synthetic-hr-subject";
const UNLISTED = "unlisted-cohort-subject";
const HR = "8867-4";
const SBP = "8480-6";
const GLUCOSE = "2339-0";

const SUBJECTS: Readonly<Record<string, SubjectScopeRow>> = {
  [SUBJECT]: { isSynthetic: true, cohortId: "synthea-v4-seed42" },
  [UNLISTED]: { isSynthetic: true, cohortId: "synthea-unlisted" },
};

const JAN = { start: "2024-01-01T00:00:00.000Z", end: "2024-01-10T00:00:00.000Z" };
const FEB = { start: "2024-02-01T00:00:00.000Z", end: "2024-02-10T00:00:00.000Z" };
const MAR = { start: "2024-03-01T00:00:00.000Z", end: "2024-03-10T00:00:00.000Z" };

type FakeRow = ObservationRecord & Readonly<{ subjectRef: string }>;

const T0 = Date.parse("2024-01-01T08:00:00.000Z");
const DAY = 86_400_000;

const row = (loinc: string, day: number, value: number, unitUcum: string): FakeRow => ({
  subjectRef: SUBJECT,
  loinc,
  value,
  unitUcum,
  effectiveAt: new Date(T0 + day * DAY),
});

/**
 * Synthetic heart rate: 70→78 every other day in early January (slope 1/day,
 * median 74, MAD 2), then 80, 84, 82 in early February. Two systolic rows on
 * 1–2 January. No glucose.
 */
const FIXTURE: readonly FakeRow[] = [
  row(HR, 0, 70, "/min"),
  row(HR, 2, 72, "/min"),
  row(HR, 4, 74, "/min"),
  row(HR, 6, 76, "/min"),
  row(HR, 8, 78, "/min"),
  row(HR, 31, 80, "/min"),
  row(HR, 33, 84, "/min"),
  row(HR, 35, 82, "/min"),
  row(SBP, 0, 120, "mm[Hg]"),
  row(SBP, 1, 122, "mm[Hg]"),
];

const fakePorts = (rows: readonly FakeRow[] = FIXTURE) => {
  const audits: AppendInput[] = [];
  const subjectLookups: string[] = [];
  const queries: ObservationQuery[] = [];
  const ports: QueryToolPorts = {
    findSubject: async (subjectRef) => {
      subjectLookups.push(subjectRef);
      return SUBJECTS[subjectRef] ?? null;
    },
    findObservations: async (query) => {
      queries.push(query);
      return rows
        .filter(
          (candidate) =>
            candidate.subjectRef === query.subjectRef &&
            query.loinc.includes(candidate.loinc) &&
            candidate.effectiveAt.getTime() >= query.start.getTime() &&
            candidate.effectiveAt.getTime() <= query.end.getTime(),
        )
        .sort((a, b) => a.effectiveAt.getTime() - b.effectiveAt.getTime())
        .slice(0, query.take);
    },
    appendAudit: async (input) => {
      audits.push(input);
    },
  };
  return { ports, audits, subjectLookups, queries };
};

const synthetic: SessionScope = {
  actor: "local",
  sessionId: "turn-b3",
  mode: "synthetic",
};
const personal: SessionScope = { actor: "local", sessionId: "turn-b3", mode: "personal" };

const auditRow = (tool: string, args: unknown, result: unknown, rowCount: number) => ({
  actor: "local",
  sessionId: "turn-b3",
  subjectRef:
    args !== null && typeof args === "object" && "subject_ref" in args
      ? args.subject_ref
      : null,
  tool,
  args,
  result,
  rowCount,
});

describe("trend", () => {
  test("January heart rate: slope 1 /min per day, fitted 70 and 78, audited with 5 rows", async () => {
    const { ports, audits } = fakePorts();
    const input = { subject_ref: SUBJECT, loinc: HR, ...JAN };
    const result = await runTrend(synthetic, input, ports);
    expect(result).toEqual({
      loinc: HR,
      unit: "/min",
      n: 5,
      first_at: "2024-01-01T08:00:00.000Z",
      last_at: "2024-01-09T08:00:00.000Z",
      slope_per_day: 1,
      slope_unit: "/min/d",
      fitted_first: 70,
      fitted_last: 78,
    });
    expect(audits).toEqual([auditRow("trend", input, result, 5)]);
  });

  test("one row: slope and fitted values are null, not 0", async () => {
    const { ports, audits } = fakePorts();
    const input = {
      subject_ref: SUBJECT,
      loinc: HR,
      start: "2024-02-01T00:00:00.000Z",
      end: "2024-02-02T00:00:00.000Z",
    };
    expect(await runTrend(synthetic, input, ports)).toEqual({
      loinc: HR,
      unit: "/min",
      n: 1,
      first_at: "2024-02-01T08:00:00.000Z",
      last_at: "2024-02-01T08:00:00.000Z",
      slope_per_day: null,
      slope_unit: "/min/d",
      fitted_first: null,
      fitted_last: null,
    });
    expect(audits.map((audit) => audit.rowCount)).toEqual([1]);
  });

  test("an empty window has no unit and audits 0 rows", async () => {
    const { ports, audits } = fakePorts();
    expect(
      await runTrend(synthetic, { subject_ref: SUBJECT, loinc: HR, ...MAR }, ports),
    ).toEqual({
      loinc: HR,
      unit: null,
      n: 0,
      first_at: null,
      last_at: null,
      slope_per_day: null,
      slope_unit: null,
      fitted_first: null,
      fitted_last: null,
    });
    expect(audits.map((audit) => audit.rowCount)).toEqual([0]);
  });
});

describe("baseline_deviation", () => {
  test("February median 82 against January (median 74, MAD 2): z = 8 / 2.9652", async () => {
    const { ports, audits } = fakePorts();
    const input = { subject_ref: SUBJECT, loinc: HR, baseline: JAN, target: FEB };
    const result = await runBaselineDeviation(synthetic, input, ports);
    expect(result).toEqual({
      loinc: HR,
      unit: "/min",
      baseline: { ...JAN, n: 5, median: 74, mad: 2 },
      target: { ...FEB, n: 3, median: 82 },
      robust_z: 8 / 2.9652,
    });
    expect(audits).toEqual([auditRow("baseline_deviation", input, result, 8)]);
  });

  test("an empty target window gives a null median and z", async () => {
    const { ports } = fakePorts();
    expect(
      await runBaselineDeviation(
        synthetic,
        { subject_ref: SUBJECT, loinc: HR, baseline: JAN, target: MAR },
        ports,
      ),
    ).toEqual({
      loinc: HR,
      unit: "/min",
      baseline: { ...JAN, n: 5, median: 74, mad: 2 },
      target: { ...MAR, n: 0, median: null },
      robust_z: null,
    });
  });

  test("a constant baseline (MAD 0) gives a null z", async () => {
    const { ports } = fakePorts([
      row(HR, 0, 70, "/min"),
      row(HR, 2, 70, "/min"),
      row(HR, 31, 90, "/min"),
    ]);
    expect(
      await runBaselineDeviation(
        synthetic,
        { subject_ref: SUBJECT, loinc: HR, baseline: JAN, target: FEB },
        ports,
      ),
    ).toEqual({
      loinc: HR,
      unit: "/min",
      baseline: { ...JAN, n: 2, median: 70, mad: 0 },
      target: { ...FEB, n: 1, median: 90 },
      robust_z: null,
    });
  });
});

describe("coverage", () => {
  test("January: heart rate 5 of 10 days, systolic 2, glucose none; 7 rows audited", async () => {
    const { ports, audits } = fakePorts();
    const input = { subject_ref: SUBJECT, loinc: [HR, SBP, GLUCOSE], ...JAN };
    const result = await runCoverage(synthetic, input, ports);
    expect(result).toEqual({
      ...JAN,
      days_in_window: 10,
      codes: [
        {
          loinc: HR,
          unit: "/min",
          n: 5,
          days_with_data: 5,
          coverage_ratio: 0.5,
          longest_gap_days: 1,
        },
        {
          loinc: SBP,
          unit: "mm[Hg]",
          n: 2,
          days_with_data: 2,
          coverage_ratio: 0.2,
          longest_gap_days: 8,
        },
        {
          loinc: GLUCOSE,
          unit: null,
          n: 0,
          days_with_data: 0,
          coverage_ratio: 0,
          longest_gap_days: 10,
        },
      ],
    });
    expect(audits).toEqual([auditRow("coverage", input, result, 7)]);
  });

  test("a code asked for twice is reported once", async () => {
    const { ports, queries } = fakePorts();
    const result = await runCoverage(
      synthetic,
      { subject_ref: SUBJECT, loinc: [SBP, SBP], ...JAN },
      ports,
    );
    expect(queries.map((query) => query.loinc)).toEqual([[SBP]]);
    expect("codes" in result ? result.codes.map((code) => code.loinc) : []).toEqual([
      SBP,
    ]);
  });
});

describe("compare_windows", () => {
  test("January vs February heart rate, B minus A; 8 rows audited", async () => {
    const { ports, audits } = fakePorts();
    const input = { subject_ref: SUBJECT, loinc: HR, window_a: JAN, window_b: FEB };
    const result = await runCompareWindows(synthetic, input, ports);
    expect(result).toEqual({
      loinc: HR,
      unit: "/min",
      window_a: { ...JAN, n: 5, mean: 74, median: 74, min: 70, max: 78 },
      window_b: { ...FEB, n: 3, mean: 82, median: 82, min: 80, max: 84 },
      delta_b_minus_a: { mean: 8, median: 8, min: 10, max: 6 },
    });
    expect(audits).toEqual([auditRow("compare_windows", input, result, 8)]);
  });

  test("an empty window B gives null stats and null deltas", async () => {
    const { ports } = fakePorts();
    expect(
      await runCompareWindows(
        synthetic,
        { subject_ref: SUBJECT, loinc: HR, window_a: JAN, window_b: MAR },
        ports,
      ),
    ).toEqual({
      loinc: HR,
      unit: "/min",
      window_a: { ...JAN, n: 5, mean: 74, median: 74, min: 70, max: 78 },
      window_b: { ...MAR, n: 0, mean: null, median: null, min: null, max: null },
      delta_b_minus_a: { mean: null, median: null, min: null, max: null },
    });
  });
});

type Run = (
  scope: SessionScope,
  subjectRef: string,
  ports: QueryToolPorts,
) => Promise<unknown>;

const RUNS: ReadonlyArray<readonly [string, Run]> = [
  [
    "trend",
    (scope, subject_ref, ports) =>
      runTrend(scope, { subject_ref, loinc: HR, ...JAN }, ports),
  ],
  [
    "baseline_deviation",
    (scope, subject_ref, ports) =>
      runBaselineDeviation(
        scope,
        { subject_ref, loinc: HR, baseline: JAN, target: FEB },
        ports,
      ),
  ],
  [
    "coverage",
    (scope, subject_ref, ports) =>
      runCoverage(scope, { subject_ref, loinc: [HR, SBP], ...JAN }, ports),
  ],
  [
    "compare_windows",
    (scope, subject_ref, ports) =>
      runCompareWindows(
        scope,
        { subject_ref, loinc: HR, window_a: JAN, window_b: FEB },
        ports,
      ),
  ],
];

describe.each(RUNS)("%s refusals", (tool, run) => {
  test("personal mode is refused before any read and audited with 0 rows", async () => {
    const { ports, audits, subjectLookups, queries } = fakePorts();
    expect(await run(personal, SUBJECT, ports)).toEqual(SUBJECT_SCOPE_VIOLATION);
    expect(subjectLookups).toEqual([]);
    expect(queries).toEqual([]);
    expect(audits.map((audit) => [audit.tool, audit.subjectRef, audit.rowCount])).toEqual(
      [[tool, SUBJECT, 0]],
    );
    expect(audits[0]?.result).toEqual(SUBJECT_SCOPE_VIOLATION);
  });

  test("a subject outside the cohort allowlist is refused without reading rows", async () => {
    const { ports, audits, queries } = fakePorts();
    expect(await run(synthetic, UNLISTED, ports)).toEqual(SUBJECT_SCOPE_VIOLATION);
    expect(queries).toEqual([]);
    expect(audits.map((audit) => [audit.tool, audit.subjectRef, audit.rowCount])).toEqual(
      [[tool, UNLISTED, 0]],
    );
  });

  test("heart rate in two units in January is refused, not averaged", async () => {
    const { ports, audits } = fakePorts([...FIXTURE, row(HR, 3, 75, "{beats}/min")]);
    const expected = mixedUnits(HR, ["/min", "{beats}/min"]);
    expect(await run(synthetic, SUBJECT, ports)).toEqual(expected);
    expect(expected).toEqual({
      code: "MIXED_UNITS",
      error: "observations for this code use more than one unit",
      loinc: HR,
      units: ["/min", "{beats}/min"],
    });
    expect(audits.map((audit) => [audit.tool, audit.rowCount])).toEqual([[tool, 0]]);
  });

  test("more than 5000 rows is refused, not truncated", async () => {
    const dense = Array.from({ length: 5001 }, (_, minute) => ({
      ...row(HR, 0, 70, "/min"),
      effectiveAt: new Date(T0 + minute * 60_000),
    }));
    const { ports, audits, queries } = fakePorts(dense);
    expect(await run(synthetic, SUBJECT, ports)).toEqual(ROW_CAP_EXCEEDED);
    expect(queries[0]?.take).toBe(5001);
    expect(audits.map((audit) => [audit.tool, audit.rowCount])).toEqual([[tool, 0]]);
  });

  test("exactly 5000 rows is accepted and audited as 5000", async () => {
    const dense = Array.from({ length: 5000 }, (_, minute) => ({
      ...row(HR, 0, 70, "/min"),
      effectiveAt: new Date(T0 + minute * 60_000),
    }));
    const { ports, audits, queries } = fakePorts(dense);
    await run(synthetic, SUBJECT, ports);
    expect(queries[0]?.take).toBe(5001);
    expect(audits.map((audit) => [audit.tool, audit.rowCount])).toEqual([[tool, 5000]]);
  });

  test("a read that throws is still audited with 0 rows and no message", async () => {
    const { ports: base, audits } = fakePorts();
    const failure = new Error("synthetic database down");
    const ports: QueryToolPorts = {
      ...base,
      findObservations: () => Promise.reject(failure),
    };
    await expect(run(synthetic, SUBJECT, ports)).rejects.toBe(failure);
    expect(
      audits.map((audit) => [audit.tool, audit.subjectRef, audit.rowCount, audit.result]),
    ).toEqual([[tool, SUBJECT, 0, { error: "query-tool-failed" }]]);
    expect(audits[0]?.result).toBe(QUERY_TOOL_FAILED);
    expect(JSON.stringify(audits)).not.toContain("synthetic database down");
  });
});

describe("inputs", () => {
  test("end before start is rejected, flat or nested", () => {
    expect(
      trendInput.safeParse({
        subject_ref: SUBJECT,
        loinc: HR,
        start: JAN.end,
        end: JAN.start,
      }).success,
    ).toBe(false);
    expect(
      compareWindowsInput.safeParse({
        subject_ref: SUBJECT,
        loinc: HR,
        window_a: JAN,
        window_b: { start: FEB.end, end: FEB.start },
      }).success,
    ).toBe(false);
  });

  test("unknown keys are rejected, not stripped", () => {
    expect(
      baselineDeviationInput.safeParse({
        subject_ref: SUBJECT,
        loinc: HR,
        baseline: JAN,
        target: FEB,
        sql: "select 1",
      }).success,
    ).toBe(false);
    expect(
      compareWindowsInput.safeParse({
        subject_ref: SUBJECT,
        loinc: HR,
        window_a: { ...JAN, limit: 10 },
        window_b: FEB,
      }).success,
    ).toBe(false);
  });

  test("coverage takes 1 to 20 codes", () => {
    const codes = (count: number) =>
      Array.from({ length: count }, (_, i) => `${i + 1}-0`);
    expect(
      coverageInput.safeParse({ subject_ref: SUBJECT, loinc: codes(20), ...JAN }).success,
    ).toBe(true);
    expect(
      coverageInput.safeParse({ subject_ref: SUBJECT, loinc: codes(21), ...JAN }).success,
    ).toBe(false);
    expect(
      coverageInput.safeParse({ subject_ref: SUBJECT, loinc: [], ...JAN }).success,
    ).toBe(false);
  });
});

describe("units across two windows", () => {
  const februaryOtherUnit = [...FIXTURE, row(HR, 32, 81, "{beats}/min")];

  test("baseline_deviation refuses when the target uses another unit", async () => {
    const { ports } = fakePorts(februaryOtherUnit);
    expect(
      await runBaselineDeviation(
        synthetic,
        { subject_ref: SUBJECT, loinc: HR, baseline: JAN, target: FEB },
        ports,
      ),
    ).toEqual(mixedUnits(HR, ["/min", "{beats}/min"]));
  });

  test("compare_windows refuses when window B uses another unit", async () => {
    const { ports } = fakePorts(februaryOtherUnit);
    expect(
      await runCompareWindows(
        synthetic,
        { subject_ref: SUBJECT, loinc: HR, window_a: JAN, window_b: FEB },
        ports,
      ),
    ).toEqual(mixedUnits(HR, ["/min", "{beats}/min"]));
  });
});

describe("plain dates", () => {
  test("a plain start and end read the whole first and last day", async () => {
    const { ports, queries } = fakePorts();
    const input = {
      subject_ref: SUBJECT,
      loinc: HR,
      start: "2024-01-01",
      end: "2024-01-09",
    };
    const result = await runTrend(synthetic, input, ports);
    expect(queries[0]?.start.toISOString()).toBe("2024-01-01T00:00:00.000Z");
    expect(queries[0]?.end.toISOString()).toBe("2024-01-09T23:59:59.999Z");
    // The 9 January 08:00 reading is inside; ending at 2024-01-09T00:00:00Z would drop it.
    expect(result).toMatchObject({ n: 5, last_at: "2024-01-09T08:00:00.000Z" });
  });

  test("a one-day window is valid and covers one day", async () => {
    const { ports } = fakePorts();
    const input = {
      subject_ref: SUBJECT,
      loinc: [SBP],
      start: "2024-01-02",
      end: "2024-01-02",
    };
    expect(coverageInput.safeParse(input).success).toBe(true);
    const result = await runCoverage(synthetic, input, ports);
    expect(result).toMatchObject({
      days_in_window: 1,
      codes: [{ loinc: SBP, n: 1, days_with_data: 1, coverage_ratio: 1 }],
    });
  });

  test("dates and datetimes mix; other date formats are rejected", () => {
    const base = { subject_ref: SUBJECT, loinc: HR };
    expect(
      trendInput.safeParse({ ...base, start: "2024-01-01", end: JAN.end }).success,
    ).toBe(true);
    expect(
      trendInput.safeParse({ ...base, start: "2024-1-1", end: "2024-01-09" }).success,
    ).toBe(false);
    expect(
      trendInput.safeParse({ ...base, start: "01/01/2024", end: "2024-01-09" }).success,
    ).toBe(false);
    expect(
      trendInput.safeParse({ ...base, start: "2024-01-09", end: "2024-01-01" }).success,
    ).toBe(false);
  });
});
