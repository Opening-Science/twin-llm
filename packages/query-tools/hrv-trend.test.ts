import { describe, expect, test } from "bun:test";

import type { WearableSummaries } from "@/infrastructure/offered-keys";
import type { AppendInput } from "@/packages/audit/append";

import type { ObservationRecord, QueryToolPorts, SubjectScopeRow } from "./ports";
import { ROW_CAP_EXCEEDED } from "./refusals";
import { SUBJECT_SCOPE_VIOLATION, type SessionScope } from "./scope";
import { QUERY_TOOL_FAILED, runHrvTrend } from "./tools";

/**
 * `hrv_trend` over synthetic snapshots and a synthetic series. Every expected
 * value is computed by hand, never by calling the code under test.
 */

const SUBJECT = "synthetic-hrv-subject";
const UNLISTED = "unlisted-cohort-subject";

const SUBJECTS: Readonly<Record<string, SubjectScopeRow>> = {
  [SUBJECT]: { isSynthetic: true, cohortId: "synthea-v4-seed42" },
  [UNLISTED]: { isSynthetic: true, cohortId: "synthea-unlisted" },
};

type FakeRow = ObservationRecord & Readonly<{ subjectRef: string }>;

const fakePorts = (rows: readonly FakeRow[] = []) => {
  const audits: AppendInput[] = [];
  const queries: unknown[] = [];
  const ports: QueryToolPorts = {
    findSubject: async (subjectRef) => SUBJECTS[subjectRef] ?? null,
    findObservations: async (query) => {
      queries.push(query);
      return rows
        .filter(
          (row) =>
            row.subjectRef === query.subjectRef &&
            query.loinc.includes(row.loinc) &&
            row.effectiveAt.getTime() >= query.start.getTime() &&
            row.effectiveAt.getTime() <= query.end.getTime(),
        )
        .sort((a, b) => a.effectiveAt.getTime() - b.effectiveAt.getTime())
        .slice(0, query.take);
    },
    appendAudit: async (input) => {
      audits.push(input);
    },
  };
  return { ports, audits, queries };
};

const personal: SessionScope = { actor: "local", sessionId: "turn", mode: "personal" };
const synthetic: SessionScope = { actor: "local", sessionId: "turn", mode: "synthetic" };

const day = (n: number): string => `2026-09-${String(n).padStart(2, "0")}`;

const metric = (key: string, date: string, value: number, unit = "ms") => ({
  key: `${key}.${date}`,
  label: key,
  value,
  date,
  unit,
});

/** Oura main-sleep HRV 40 to 49 on 1–10 Sep, plus a nap that must not count. */
const OURA = {
  window: { startDate: "2026-09-01", endDate: "2026-09-10" },
  metrics: [
    ...Array.from({ length: 10 }, (_, i) =>
      metric("sleep.hrv.long_sleep", day(i + 1), 40 + i),
    ),
    metric("sleep.hrv.late_nap", day(5), 90),
  ],
  narrative: "synthetic",
};

/** Whoop recovery HRV on three days only. */
const WHOOP = {
  window: { startDate: "2026-09-01", endDate: "2026-09-10" },
  metrics: [
    metric("whoop.recovery.hrv", day(8), 60),
    metric("whoop.recovery.hrv", day(9), 62),
    metric("whoop.recovery.hrv", day(10), 64),
  ],
  narrative: "synthetic",
};

const LINKED: WearableSummaries = {
  oura: OURA,
  whoop: WHOOP,
  googleHealth: null,
  vitronic: null,
};

const SEPT = { start: "2026-09-01", end: "2026-09-10" };

describe("hrv_trend, personal snapshots", () => {
  test("Oura and Whoop: exact output per source, audited with 13 readings", async () => {
    const { ports, audits } = fakePorts();
    const input = { source: "all" as const, ...SEPT };
    const result = await runHrvTrend(personal, input, ports, LINKED);
    expect(result).toEqual({
      measure: "hrv",
      start: "2026-09-01",
      end: "2026-09-10",
      n: 13,
      sources: [
        {
          source: "oura",
          key: "sleep.hrv.long_sleep",
          unit: "ms",
          n: 10,
          first_day: "2026-09-01",
          last_day: "2026-09-10",
          // 40 + day index: one ms a day, exactly.
          slope_per_day: 1,
          slope_per_week: 7,
          slope_unit: "ms/d",
          slope_per_week_unit: "ms/wk",
          fitted_first: 40,
          fitted_last: 49,
          // 4–10 Sep: 43 to 49.
          recent: { start: "2026-09-04", end: "2026-09-10", n: 7, median: 46 },
          // 7 Aug – 3 Sep: 40, 41, 42; deviations 1, 0, 1.
          baseline: { start: "2026-08-07", end: "2026-09-03", n: 3, median: 41, mad: 1 },
          robust_z: (46 - 41) / (1.4826 * 1),
        },
        {
          source: "whoop",
          key: "whoop.recovery.hrv",
          unit: "ms",
          n: 3,
          first_day: "2026-09-08",
          last_day: "2026-09-10",
          // Under 7 readings: counts and medians, no slope.
          slope_per_day: null,
          slope_per_week: null,
          slope_unit: null,
          slope_per_week_unit: null,
          fitted_first: null,
          fitted_last: null,
          recent: { start: "2026-09-04", end: "2026-09-10", n: 3, median: 62 },
          baseline: {
            start: "2026-08-07",
            end: "2026-09-03",
            n: 0,
            median: null,
            mad: null,
          },
          robust_z: null,
        },
      ],
    });
    expect(audits).toEqual([
      {
        actor: "local",
        sessionId: "turn",
        subjectRef: null,
        tool: "hrv_trend",
        args: input,
        result,
        rowCount: 13,
      },
    ]);
  });

  test("Whoop alone has 3 readings: WINDOW_TOO_SHORT, audited with 0 rows", async () => {
    const { ports, audits } = fakePorts();
    expect(
      await runHrvTrend(personal, { source: "whoop", ...SEPT }, ports, LINKED),
    ).toEqual({
      code: "WINDOW_TOO_SHORT",
      error:
        "fewer than 7 daily readings from every source in this window; too few for a trend",
      measure: "hrv",
      minimum: 7,
      counts: [{ source: "whoop", n: 3 }],
    });
    expect(audits.map((audit) => audit.rowCount)).toEqual([0]);
  });

  test("a source that is not linked is SOURCE_NOT_CONNECTED", async () => {
    const { ports } = fakePorts();
    expect(
      await runHrvTrend(personal, { source: "google", ...SEPT }, ports, LINKED),
    ).toEqual({
      code: "SOURCE_NOT_CONNECTED",
      error: "this wearable is not linked for this turn",
      source: "google",
      available: ["oura", "whoop"],
    });
  });

  test("no linked wearable at all is SOURCE_NOT_CONNECTED for all", async () => {
    const { ports } = fakePorts();
    expect(await runHrvTrend(personal, { source: "all", ...SEPT }, ports)).toEqual({
      code: "SOURCE_NOT_CONNECTED",
      error: "no wearable is linked for this turn",
      source: "all",
      available: [],
    });
  });

  test("a window without readings is NO_ROWS", async () => {
    const { ports } = fakePorts();
    const input = { source: "all" as const, start: "2026-10-01", end: "2026-10-20" };
    expect(await runHrvTrend(personal, input, ports, LINKED)).toEqual({
      code: "NO_ROWS",
      error: "no reading of this measure from this source in this window",
      measure: "hrv",
      source: "all",
    });
  });

  test("one Oura reading in seconds is MIXED_UNITS, nothing converted", async () => {
    const { ports } = fakePorts();
    const wearables = {
      ...LINKED,
      oura: {
        ...OURA,
        metrics: [...OURA.metrics, metric("sleep.hrv.long_sleep", day(11), 0.05, "s")],
      },
    };
    const input = { source: "oura" as const, start: "2026-09-01", end: "2026-09-11" };
    expect(await runHrvTrend(personal, input, ports, wearables)).toEqual({
      code: "MIXED_UNITS",
      error:
        "this source's readings of this measure are not all in the one unit the tool reports",
      measure: "hrv",
      source: "oura",
      units: ["ms", "s"],
    });
  });

  test("a subject_ref in personal mode is refused before anything is read", async () => {
    const { ports, audits } = fakePorts();
    const input = { subject_ref: SUBJECT, source: "all" as const, ...SEPT };
    expect(await runHrvTrend(personal, input, ports, LINKED)).toEqual(
      SUBJECT_SCOPE_VIOLATION,
    );
    expect(audits.map((audit) => [audit.subjectRef, audit.rowCount])).toEqual([
      [SUBJECT, 0],
    ]);
  });
});

const T7 = (n: number): Date => new Date(`${day(n)}T07:00:00.000Z`);

/** Synthetic RMSSD 50 + 2 per day on 1–8 Sep, and a resting heart rate row it must not read. */
const SERIES: readonly FakeRow[] = [
  ...Array.from({ length: 8 }, (_, i) => ({
    subjectRef: SUBJECT,
    loinc: "hrv-rmssd",
    value: 50 + 2 * i,
    unitUcum: "ms",
    effectiveAt: T7(i + 1),
  })),
  {
    subjectRef: SUBJECT,
    loinc: "40443-4",
    value: 60,
    unitUcum: "/min",
    effectiveAt: T7(3),
  },
];

const SYNTH_INPUT = {
  subject_ref: SUBJECT,
  source: "all" as const,
  start: "2026-09-01",
  end: "2026-09-08",
};

describe("hrv_trend, synthetic series", () => {
  test("one capped read from the baseline's first day, source synthetic", async () => {
    const { ports, audits, queries } = fakePorts(SERIES);
    const result = await runHrvTrend(synthetic, SYNTH_INPUT, ports);
    expect(queries).toEqual([
      {
        subjectRef: SUBJECT,
        loinc: ["hrv-rmssd"],
        start: new Date("2026-08-05T00:00:00.000Z"),
        end: new Date("2026-09-08T23:59:59.999Z"),
        take: 5001,
      },
    ]);
    expect(result).toEqual({
      measure: "hrv",
      start: "2026-09-01",
      end: "2026-09-08",
      n: 8,
      sources: [
        {
          source: "synthetic",
          key: "hrv-rmssd",
          unit: "ms",
          n: 8,
          first_day: "2026-09-01",
          last_day: "2026-09-08",
          slope_per_day: 2,
          slope_per_week: 14,
          slope_unit: "ms/d",
          slope_per_week_unit: "ms/wk",
          fitted_first: 50,
          fitted_last: 64,
          // 2–8 Sep: 52 to 64.
          recent: { start: "2026-09-02", end: "2026-09-08", n: 7, median: 58 },
          // 5 Aug – 1 Sep: 50 alone, so the MAD is 0 and there is no z.
          baseline: { start: "2026-08-05", end: "2026-09-01", n: 1, median: 50, mad: 0 },
          robust_z: null,
        },
      ],
    });
    expect(audits.map((audit) => [audit.subjectRef, audit.rowCount])).toEqual([
      [SUBJECT, 8],
    ]);
  });

  test("a vendor source for a synthetic subject is SOURCE_NOT_CONNECTED, nothing read", async () => {
    const { ports, queries } = fakePorts(SERIES);
    expect(
      await runHrvTrend(synthetic, { ...SYNTH_INPUT, source: "oura" }, ports),
    ).toEqual({
      code: "SOURCE_NOT_CONNECTED",
      error:
        "a synthetic subject has one synthetic series, read with source all; no wearable vendor is linked to it",
      source: "oura",
      available: ["synthetic"],
    });
    expect(queries).toEqual([]);
  });

  test("no subject_ref, or one outside the allowlist, is refused without a read", async () => {
    const { ports, queries, audits } = fakePorts(SERIES);
    const { subject_ref: _, ...withoutSubject } = SYNTH_INPUT;
    expect(await runHrvTrend(synthetic, withoutSubject, ports)).toEqual(
      SUBJECT_SCOPE_VIOLATION,
    );
    expect(
      await runHrvTrend(synthetic, { ...SYNTH_INPUT, subject_ref: UNLISTED }, ports),
    ).toEqual(SUBJECT_SCOPE_VIOLATION);
    expect(queries).toEqual([]);
    expect(audits.map((audit) => [audit.subjectRef, audit.rowCount])).toEqual([
      [null, 0],
      [UNLISTED, 0],
    ]);
  });

  test("more than 5000 rows is refused, not truncated", async () => {
    const dense = Array.from({ length: 5001 }, (_, minute) => ({
      ...SERIES[0]!,
      effectiveAt: new Date(T7(1).getTime() + minute * 60_000),
    }));
    const { ports, audits } = fakePorts(dense);
    expect(await runHrvTrend(synthetic, SYNTH_INPUT, ports)).toEqual(ROW_CAP_EXCEEDED);
    expect(audits.map((audit) => audit.rowCount)).toEqual([0]);
  });

  test("a read that throws is still audited with 0 rows and no message", async () => {
    const { ports: base, audits } = fakePorts(SERIES);
    const ports: QueryToolPorts = {
      ...base,
      findObservations: () => Promise.reject(new Error("synthetic database down")),
    };
    await expect(runHrvTrend(synthetic, SYNTH_INPUT, ports)).rejects.toThrow(
      "synthetic database down",
    );
    expect(audits.map((audit) => [audit.result, audit.rowCount])).toEqual([
      [QUERY_TOOL_FAILED, 0],
    ]);
  });
});
