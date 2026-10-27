import { describe, expect, test } from "bun:test";

import type { WearableSummaries } from "@/infrastructure/offered-keys";
import type { AppendInput } from "@/packages/audit/append";

import type { ObservationRecord, QueryToolPorts, SubjectScopeRow } from "./ports";
import { SUBJECT_SCOPE_VIOLATION, type SessionScope } from "./scope";
import { runSleepSummary } from "./tools";

/**
 * `sleep_summary` over synthetic snapshots and a synthetic series. Every
 * expected value is computed by hand.
 */

const SUBJECT = "synthetic-sleep-subject";

const SUBJECTS: Readonly<Record<string, SubjectScopeRow>> = {
  [SUBJECT]: { isSynthetic: true, cohortId: "synthea-v4-seed42" },
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

const metric = (key: string, date: string, value: number, unit?: string) => ({
  key: `${key}.${date}`,
  label: key,
  value,
  date,
  ...(unit === undefined ? {} : { unit }),
});

const D1 = "2026-09-01";
const D2 = "2026-09-02";
const D3 = "2026-09-03";

/** Oura: two full nights, a nap on the first day that must not count, and a score alone. */
const OURA_METRICS = [
  metric("sleep.duration.long_sleep", D1, 420, "min"),
  metric("sleep.efficiency.long_sleep", D1, 90, "%"),
  metric("sleep.score.long_sleep", D1, 80),
  metric("sleep.duration.late_nap", D1, 30, "min"),
  metric("sleep.duration.long_sleep", D2, 480, "min"),
  metric("sleep.efficiency.long_sleep", D2, 86, "%"),
  metric("sleep.score.long_sleep", D2, 70),
  metric("sleep.score.long_sleep", D3, 75),
];

const WHOOP_METRICS = [
  metric("whoop.sleep.in_bed_min", D1, 500, "min"),
  metric("whoop.sleep.efficiency", D1, 91.5, "%"),
  metric("whoop.sleep.performance", D1, 88, "%"),
  metric("whoop.sleep.in_bed_min", D2, 460, "min"),
  metric("whoop.sleep.efficiency", D2, 89.5, "%"),
  metric("whoop.sleep.performance", D2, 84, "%"),
];

const snapshot = (metrics: readonly ReturnType<typeof metric>[]) => ({
  window: { startDate: D1, endDate: D3 },
  metrics,
  narrative: "synthetic",
});

const LINKED: WearableSummaries = {
  oura: snapshot(OURA_METRICS),
  whoop: snapshot(WHOOP_METRICS),
  googleHealth: snapshot([metric("google.daily-resting-heart-rate", D1, 60, "/min")]),
  vitronic: null,
};

const WINDOW = { start: D1, end: D3 };

describe("sleep_summary, personal snapshots", () => {
  test("main sleep per night and per-source averages, audited with 13 readings", async () => {
    const { ports, audits } = fakePorts();
    const input = { source: "all" as const, ...WINDOW };
    const result = await runSleepSummary(personal, input, ports, LINKED);
    expect(result).toEqual({
      start: D1,
      end: D3,
      n: 13,
      sources: [
        {
          source: "oura",
          nights: 3,
          score_name: "Oura sleep score",
          score_unit: null,
          mean_duration_min: 450,
          mean_in_bed_min: null,
          mean_efficiency_pct: 88,
          mean_score: 75,
        },
        {
          source: "whoop",
          nights: 2,
          score_name: "Whoop sleep performance",
          score_unit: "%",
          mean_duration_min: null,
          mean_in_bed_min: 480,
          mean_efficiency_pct: 90.5,
          mean_score: 86,
        },
      ],
      nights: [
        {
          source: "oura",
          day: D1,
          duration_min: 420,
          in_bed_min: null,
          efficiency_pct: 90,
          score: 80,
        },
        {
          source: "whoop",
          day: D1,
          duration_min: null,
          in_bed_min: 500,
          efficiency_pct: 91.5,
          score: 88,
        },
        {
          source: "oura",
          day: D2,
          duration_min: 480,
          in_bed_min: null,
          efficiency_pct: 86,
          score: 70,
        },
        {
          source: "whoop",
          day: D2,
          duration_min: null,
          in_bed_min: 460,
          efficiency_pct: 89.5,
          score: 84,
        },
        {
          source: "oura",
          day: D3,
          duration_min: null,
          in_bed_min: null,
          efficiency_pct: null,
          score: 75,
        },
      ],
    });
    expect(audits).toEqual([
      {
        actor: "local",
        sessionId: "turn",
        subjectRef: null,
        tool: "sleep_summary",
        args: input,
        result,
        rowCount: 13,
      },
    ]);
  });

  test("Google is linked but its summary holds no sleep: NO_ROWS", async () => {
    const { ports, audits } = fakePorts();
    expect(
      await runSleepSummary(personal, { source: "google", ...WINDOW }, ports, LINKED),
    ).toEqual({
      code: "NO_ROWS",
      error: "no reading of this measure from this source in this window",
      measure: "sleep",
      source: "google",
    });
    expect(audits.map((audit) => audit.rowCount)).toEqual([0]);
  });

  test("an Oura duration in hours is MIXED_UNITS, not converted", async () => {
    const { ports } = fakePorts();
    const wearables = {
      ...LINKED,
      oura: snapshot([...OURA_METRICS, metric("sleep.duration.long_sleep", D3, 7, "h")]),
    };
    expect(
      await runSleepSummary(personal, { source: "oura", ...WINDOW }, ports, wearables),
    ).toEqual({
      code: "MIXED_UNITS",
      error:
        "this source's readings of this measure are not all in the one unit the tool reports",
      measure: "sleep.duration",
      source: "oura",
      units: ["h", "min"],
    });
  });

  test("a Whoop snapshot that is not linked is SOURCE_NOT_CONNECTED", async () => {
    const { ports } = fakePorts();
    expect(
      await runSleepSummary(personal, { source: "whoop", ...WINDOW }, ports, {
        ...LINKED,
        whoop: null,
      }),
    ).toEqual({
      code: "SOURCE_NOT_CONNECTED",
      error: "this wearable is not linked for this turn",
      source: "whoop",
      available: ["oura", "google"],
    });
  });
});

describe("sleep_summary, synthetic series", () => {
  const row = (
    loinc: string,
    date: string,
    value: number,
    unitUcum: string,
  ): FakeRow => ({
    subjectRef: SUBJECT,
    loinc,
    value,
    unitUcum,
    effectiveAt: new Date(`${date}T07:00:00.000Z`),
  });
  const SERIES = [
    row("93832-4", D1, 400, "min"),
    row("sleep-score", D1, 70, "{score}"),
    row("93832-4", D2, 410, "min"),
    row("sleep-score", D2, 72, "{score}"),
  ];
  const INPUT = { subject_ref: SUBJECT, source: "all" as const, start: D1, end: D2 };

  test("reads sleep duration and the synthetic score in the window only", async () => {
    const { ports, queries, audits } = fakePorts(SERIES);
    expect(await runSleepSummary(synthetic, INPUT, ports)).toEqual({
      start: D1,
      end: D2,
      n: 4,
      sources: [
        {
          source: "synthetic",
          nights: 2,
          score_name: "synthetic sleep score",
          score_unit: "{score}",
          mean_duration_min: 405,
          mean_in_bed_min: null,
          mean_efficiency_pct: null,
          mean_score: 71,
        },
      ],
      nights: [
        {
          source: "synthetic",
          day: D1,
          duration_min: 400,
          in_bed_min: null,
          efficiency_pct: null,
          score: 70,
        },
        {
          source: "synthetic",
          day: D2,
          duration_min: 410,
          in_bed_min: null,
          efficiency_pct: null,
          score: 72,
        },
      ],
    });
    expect(queries).toEqual([
      {
        subjectRef: SUBJECT,
        loinc: ["93832-4", "sleep-score"],
        start: new Date("2026-09-01T00:00:00.000Z"),
        end: new Date("2026-09-02T23:59:59.999Z"),
        take: 5001,
      },
    ]);
    expect(audits.map((audit) => [audit.subjectRef, audit.rowCount])).toEqual([
      [SUBJECT, 4],
    ]);
  });

  test("an empty window is NO_ROWS; Whoop for a synthetic subject is SOURCE_NOT_CONNECTED", async () => {
    const { ports } = fakePorts(SERIES);
    expect(
      await runSleepSummary(
        synthetic,
        { ...INPUT, start: "2026-10-01", end: "2026-10-07" },
        ports,
      ),
    ).toEqual({
      code: "NO_ROWS",
      error: "no reading of this measure from this source in this window",
      measure: "sleep",
      source: "all",
    });
    expect(
      await runSleepSummary(synthetic, { ...INPUT, source: "whoop" }, ports),
    ).toEqual({
      code: "SOURCE_NOT_CONNECTED",
      error:
        "a synthetic subject has one synthetic series, read with source all; no wearable vendor is linked to it",
      source: "whoop",
      available: ["synthetic"],
    });
  });

  test("personal mode never reads a synthetic subject", async () => {
    const { ports, queries } = fakePorts(SERIES);
    expect(await runSleepSummary(personal, INPUT, ports, LINKED)).toEqual(
      SUBJECT_SCOPE_VIOLATION,
    );
    expect(queries).toEqual([]);
  });
});
