import { describe, expect, test } from "bun:test";

import type { AppendInput } from "@/packages/audit/append";

import MOCK_DAY from "./fixtures/mock-day.json";
import type { ObservationRecord, QueryToolPorts, SubjectScopeRow } from "./ports";
import { mixedUnits, ROW_CAP_EXCEEDED } from "./refusals";
import { SUBJECT_SCOPE_VIOLATION, type SessionScope } from "./scope";
import { readingsFromRows, type ShowMyDayResult } from "./show-my-day";
import { QUERY_TOOL_FAILED, runShowMyDay } from "./tools";

/**
 * `show_my_day` over the illustrative mock day stored as synthetic rows.
 * Every expected value is written out by hand.
 */

const SUBJECT = "synthetic-show-my-day-subject";
const UNLISTED = "unlisted-cohort-subject";
const DAY = "2026-11-16";

const SUBJECTS: Readonly<Record<string, SubjectScopeRow>> = {
  [SUBJECT]: { isSynthetic: true, cohortId: "synthea-v4-seed42" },
  [UNLISTED]: { isSynthetic: true, cohortId: "synthea-unlisted" },
};

type FakeRow = ObservationRecord & Readonly<{ subjectRef: string }>;

const at = (time: string, day = DAY): Date => new Date(`${day}T${time}:00.000Z`);

/** The mock day as warehouse rows: heart rate in /min, glucose in blood in mg/dL. */
const FIXTURE: readonly FakeRow[] = MOCK_DAY.readings.flatMap((reading) => [
  {
    subjectRef: SUBJECT,
    loinc: "8867-4",
    value: reading.heart_rate_per_min,
    unitUcum: "/min",
    effectiveAt: at(reading.time),
  },
  {
    subjectRef: SUBJECT,
    loinc: "2339-0",
    value: reading.glucose_mg_dl,
    unitUcum: "mg/dL",
    effectiveAt: at(reading.time),
  },
]);

const fakePorts = (rows: readonly FakeRow[] = FIXTURE) => {
  const audits: AppendInput[] = [];
  const queries: unknown[] = [];
  const ports: QueryToolPorts = {
    findSubject: async (subjectRef) => SUBJECTS[subjectRef] ?? null,
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
    findCohortObservations: async () => [],
    appendAudit: async (input) => {
      audits.push(input);
    },
  };
  return { ports, audits, queries };
};

const synthetic: SessionScope = { actor: "local", sessionId: "turn", mode: "synthetic" };
const personal: SessionScope = { actor: "local", sessionId: "turn", mode: "personal" };

const INPUT = { subject_ref: SUBJECT, day: DAY, profile: "without_diabetes" } as const;

describe("readingsFromRows", () => {
  test("pairs heart rate and glucose by minute, with no event and unknown activity", () => {
    expect(readingsFromRows(FIXTURE.slice(0, 4))).toEqual([
      { time: "03:00", event: null, heartRatePerMin: 52, glucoseMgDl: 85, moving: null },
      { time: "06:30", event: null, heartRatePerMin: 70, glucoseMgDl: 95, moving: null },
    ]);
  });
});

describe("show_my_day", () => {
  test("the mock day: beats, one red window, audited with 28 rows", async () => {
    const { ports, audits, queries } = fakePorts();
    const result = (await runShowMyDay(synthetic, INPUT, ports)) as ShowMyDayResult;
    expect(queries).toEqual([
      {
        subjectRef: SUBJECT,
        loinc: ["8867-4", "2339-0", "2345-7"],
        start: new Date(`${DAY}T00:00:00.000Z`),
        end: new Date(`${DAY}T23:59:59.999Z`),
        take: 5001,
      },
    ]);
    expect({ ...result, beats: result.beats.length }).toEqual({
      subject_ref: SUBJECT,
      day: DAY,
      profile: "without_diabetes",
      n: 28,
      beats: 18,
      red_windows: [
        {
          from: "20:30",
          to: "20:30",
          measure: "glucose",
          extreme: 175,
          rule: "Blood glucose above 140 mg/dL (placeholder, without diabetes)",
          thresholds: "placeholder",
        },
      ],
      thresholds: { status: "placeholder", reviewer: "Robin" },
      activity: "not recorded",
    });
    expect(
      result.beats.map((beat) => [beat.time, beat.event, beat.source, beat.signal.value]),
    ).toEqual([
      ["03:00", "Reading", "measured", 52],
      ["06:30", "Reading", "measured", 70],
      ["07:30", "Reading", "measured", 64],
      ["08:15", "Reading", "measured", 135],
      ["08:15", "Reading", "narrated", null],
      ["10:00", "Reading", "measured", 92],
      ["10:30", "Reading", "measured", 88],
      ["12:30", "Reading", "measured", 68],
      ["13:00", "Reading", "measured", 100],
      ["13:00", "Reading", "narrated", null],
      ["15:30", "Reading", "measured", 68],
      ["18:00", "Reading", "measured", 160],
      ["18:45", "Reading", "measured", 85],
      ["19:30", "Reading", "measured", 100],
      ["20:30", "Reading", "measured", 175],
      ["20:30", "Reading", "narrated", null],
      ["20:30", "Red window", "derived", 175],
      ["22:30", "Reading", "measured", 105],
    ]);
    expect(audits).toEqual([
      {
        actor: "local",
        sessionId: "turn",
        subjectRef: SUBJECT,
        tool: "show_my_day",
        args: INPUT,
        result,
        rowCount: 28,
      },
    ]);
  });

  test("with diabetes the same day has no red window", async () => {
    const { ports } = fakePorts();
    const result = (await runShowMyDay(
      synthetic,
      { ...INPUT, profile: "with_diabetes" },
      ports,
    )) as ShowMyDayResult;
    expect(result.red_windows).toEqual([]);
  });

  test("a day with no rows has no beats and audits 0 rows", async () => {
    const { ports, audits } = fakePorts();
    expect(await runShowMyDay(synthetic, { ...INPUT, day: "2026-11-17" }, ports)).toEqual(
      {
        subject_ref: SUBJECT,
        day: "2026-11-17",
        profile: "without_diabetes",
        n: 0,
        beats: [],
        red_windows: [],
        thresholds: { status: "placeholder", reviewer: "Robin" },
        activity: "not recorded",
      },
    );
    expect(audits.map((audit) => audit.rowCount)).toEqual([0]);
  });

  test("personal mode is refused before any read and audited with 0 rows", async () => {
    const { ports, audits, queries } = fakePorts();
    expect(await runShowMyDay(personal, INPUT, ports)).toEqual(SUBJECT_SCOPE_VIOLATION);
    expect(queries).toEqual([]);
    expect(audits.map((audit) => [audit.tool, audit.rowCount])).toEqual([
      ["show_my_day", 0],
    ]);
  });

  test("a subject outside the cohort allowlist is refused without reading rows", async () => {
    const { ports, audits, queries } = fakePorts();
    const input = { ...INPUT, subject_ref: UNLISTED };
    expect(await runShowMyDay(synthetic, input, ports)).toEqual(SUBJECT_SCOPE_VIOLATION);
    expect(queries).toEqual([]);
    expect(audits.map((audit) => [audit.subjectRef, audit.rowCount])).toEqual([
      [UNLISTED, 0],
    ]);
  });

  test("glucose in mmol/L is refused, never converted", async () => {
    const { ports, audits } = fakePorts([
      ...FIXTURE,
      {
        subjectRef: SUBJECT,
        loinc: "2345-7",
        value: 5.4,
        unitUcum: "mmol/L",
        effectiveAt: at("09:00"),
      },
    ]);
    expect(await runShowMyDay(synthetic, INPUT, ports)).toEqual(
      mixedUnits("2339-0", ["mg/dL", "mmol/L"]),
    );
    expect(audits.map((audit) => audit.rowCount)).toEqual([0]);
  });

  test("heart rate not in /min is refused", async () => {
    const { ports } = fakePorts([
      ...FIXTURE,
      {
        subjectRef: SUBJECT,
        loinc: "8867-4",
        value: 70,
        unitUcum: "{beats}/min",
        effectiveAt: at("09:00"),
      },
    ]);
    expect(await runShowMyDay(synthetic, INPUT, ports)).toEqual(
      mixedUnits("8867-4", ["/min", "{beats}/min"]),
    );
  });

  test("more than 5000 rows is refused, not truncated", async () => {
    const dense = Array.from({ length: 5001 }, (_, second) => ({
      subjectRef: SUBJECT,
      loinc: "8867-4",
      value: 70,
      unitUcum: "/min",
      effectiveAt: new Date(at("00:00").getTime() + second * 1000),
    }));
    const { ports, audits } = fakePorts(dense);
    expect(await runShowMyDay(synthetic, INPUT, ports)).toEqual(ROW_CAP_EXCEEDED);
    expect(audits.map((audit) => audit.rowCount)).toEqual([0]);
  });

  test("a read that throws is still audited with 0 rows and no message", async () => {
    const { ports: base, audits } = fakePorts();
    const ports: QueryToolPorts = {
      ...base,
      findObservations: () => Promise.reject(new Error("synthetic database down")),
    };
    await expect(runShowMyDay(synthetic, INPUT, ports)).rejects.toThrow(
      "synthetic database down",
    );
    expect(audits.map((audit) => [audit.result, audit.rowCount])).toEqual([
      [QUERY_TOOL_FAILED, 0],
    ]);
  });
});
