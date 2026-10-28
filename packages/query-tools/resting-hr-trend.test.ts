import { describe, expect, test } from "bun:test";

import type { WearableSummaries } from "@/infrastructure/offered-keys";
import type { AppendInput } from "@/packages/audit/append";

import type { ObservationRecord, QueryToolPorts, SubjectScopeRow } from "./ports";
import { SUBJECT_SCOPE_VIOLATION, type SessionScope } from "./scope";
import { runRestingHrTrend } from "./tools";

/**
 * `resting_hr_trend` over synthetic snapshots and a synthetic series. The
 * shared paths (scope, cap, throw) are covered in hrv-trend.test.ts; this
 * checks the measure's own sources. Values are computed by hand.
 */

const SUBJECT = "synthetic-rhr-subject";

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

const day = (n: number): string => `2026-09-0${n}`;

const metric = (key: string, date: string, value: number, unit: string) => ({
  key: `${key}.${date}`,
  label: key,
  value,
  date,
  unit,
});

const WHOOP_RHR = [58, 58, 57, 57, 56, 56, 55, 55];

/** Oura is linked but its summary has no resting heart rate; Whoop and Google do. */
const LINKED: WearableSummaries = {
  oura: {
    window: { startDate: "2026-09-01", endDate: "2026-09-08" },
    metrics: [metric("sleep.hr.long_sleep", day(1), 54, "bpm")],
    narrative: "synthetic",
  },
  whoop: {
    window: { startDate: "2026-09-01", endDate: "2026-09-08" },
    metrics: WHOOP_RHR.map((value, i) =>
      metric("whoop.recovery.rhr", day(i + 1), value, "bpm"),
    ),
    narrative: "synthetic",
  },
  googleHealth: {
    window: { startDate: "2026-09-01", endDate: "2026-09-08" },
    metrics: Array.from({ length: 8 }, (_, i) =>
      metric("google.daily-resting-heart-rate", day(i + 1), 60, "/min"),
    ),
    narrative: "synthetic",
  },
  vitronic: null,
};

const WINDOW = { start: "2026-09-01", end: "2026-09-08" };

describe("resting_hr_trend", () => {
  test("Whoop and Google rows, each with its own unit; Oura has none", async () => {
    const { ports, audits } = fakePorts();
    const result = await runRestingHrTrend(
      personal,
      { source: "all", ...WINDOW },
      ports,
      LINKED,
    );
    expect(result).toEqual({
      measure: "resting_hr",
      start: "2026-09-01",
      end: "2026-09-08",
      n: 16,
      sources: [
        {
          source: "whoop",
          key: "whoop.recovery.rhr",
          unit: "bpm",
          n: 8,
          first_day: "2026-09-01",
          last_day: "2026-09-08",
          // Σ(x − 3.5)(y − 56.5) = −20, Σ(x − 3.5)² = 42.
          slope_per_day: -20 / 42,
          slope_per_week: (-20 / 42) * 7,
          slope_unit: "bpm/d",
          slope_per_week_unit: "bpm/wk",
          fitted_first: 56.5 + (20 / 42) * 3.5,
          fitted_last: 56.5 - (20 / 42) * 3.5,
          recent: { start: "2026-09-02", end: "2026-09-08", n: 7, median: 56 },
          baseline: { start: "2026-08-05", end: "2026-09-01", n: 1, median: 58, mad: 0 },
          robust_z: null,
        },
        {
          source: "google",
          key: "google.daily-resting-heart-rate",
          unit: "/min",
          n: 8,
          first_day: "2026-09-01",
          last_day: "2026-09-08",
          slope_per_day: 0,
          slope_per_week: 0,
          slope_unit: "/min/d",
          slope_per_week_unit: "/min/wk",
          fitted_first: 60,
          fitted_last: 60,
          recent: { start: "2026-09-02", end: "2026-09-08", n: 7, median: 60 },
          baseline: { start: "2026-08-05", end: "2026-09-01", n: 1, median: 60, mad: 0 },
          robust_z: null,
        },
      ],
    });
    expect(audits.map((audit) => [audit.tool, audit.rowCount])).toEqual([
      ["resting_hr_trend", 16],
    ]);
  });

  test("Oura alone is linked but records none: NO_ROWS", async () => {
    const { ports } = fakePorts();
    expect(
      await runRestingHrTrend(personal, { source: "oura", ...WINDOW }, ports, LINKED),
    ).toEqual({
      code: "NO_ROWS",
      error: "no reading of this measure from this source in this window",
      measure: "resting_hr",
      source: "oura",
    });
  });

  test("synthetic mode reads LOINC 40443-4 for the subject", async () => {
    const rows: readonly FakeRow[] = Array.from({ length: 7 }, (_, i) => ({
      subjectRef: SUBJECT,
      loinc: "40443-4",
      value: 62,
      unitUcum: "/min",
      effectiveAt: new Date(`${day(i + 2)}T07:00:00.000Z`),
    }));
    const { ports, queries } = fakePorts(rows);
    const result = await runRestingHrTrend(
      synthetic,
      { subject_ref: SUBJECT, source: "all", ...WINDOW },
      ports,
    );
    expect(queries).toEqual([
      {
        subjectRef: SUBJECT,
        loinc: ["40443-4"],
        start: new Date("2026-08-05T00:00:00.000Z"),
        end: new Date("2026-09-08T23:59:59.999Z"),
        take: 5001,
      },
    ]);
    expect(result).toEqual({
      measure: "resting_hr",
      start: "2026-09-01",
      end: "2026-09-08",
      n: 7,
      sources: [
        {
          source: "synthetic",
          key: "40443-4",
          unit: "/min",
          n: 7,
          first_day: "2026-09-02",
          last_day: "2026-09-08",
          slope_per_day: 0,
          slope_per_week: 0,
          slope_unit: "/min/d",
          slope_per_week_unit: "/min/wk",
          fitted_first: 62,
          fitted_last: 62,
          recent: { start: "2026-09-02", end: "2026-09-08", n: 7, median: 62 },
          baseline: {
            start: "2026-08-05",
            end: "2026-09-01",
            n: 0,
            median: null,
            mad: null,
          },
          robust_z: null,
        },
      ],
    });
  });

  test("personal mode with a subject_ref is refused", async () => {
    const { ports } = fakePorts();
    expect(
      await runRestingHrTrend(
        personal,
        { subject_ref: SUBJECT, source: "all", ...WINDOW },
        ports,
        LINKED,
      ),
    ).toEqual(SUBJECT_SCOPE_VIOLATION);
  });
});
