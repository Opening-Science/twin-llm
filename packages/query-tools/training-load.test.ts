import { describe, expect, test } from "bun:test";

import type { WearableSummaries } from "@/infrastructure/offered-keys";
import type { AppendInput } from "@/packages/audit/append";

import type { ObservationRecord, QueryToolPorts, SubjectScopeRow } from "./ports";
import { SUBJECT_SCOPE_VIOLATION, type SessionScope } from "./scope";
import { recentLoadRatio, weekStart } from "./stats";
import { QUERY_TOOL_FAILED, runTrainingLoad } from "./tools";
import { sportGroup } from "./wearable-readings";

/**
 * `training_load` over synthetic snapshots and a synthetic series. Every
 * expected value is computed by hand. 28 Sep 2026 is a Monday.
 */

const SUBJECT = "synthetic-load-subject";

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

/**
 * Whoop: two runs on 28 Sep (the second keyed `running_2`), functional fitness
 * on 30 Sep, and a run on 10 Sep, in the four weeks before.
 */
const WHOOP_METRICS = [
  metric("whoop.workout.duration.running", "2026-09-10", 60, "min"),
  metric("whoop.workout.strain.running", "2026-09-10", 12),
  metric("whoop.workout.duration.running", "2026-09-28", 30, "min"),
  metric("whoop.workout.strain.running", "2026-09-28", 8.5),
  metric("whoop.workout.avg_hr.running", "2026-09-28", 140, "bpm"),
  metric("whoop.workout.duration.running_2", "2026-09-28", 20, "min"),
  metric("whoop.workout.strain.running_2", "2026-09-28", 6.1),
  metric("whoop.workout.duration.functional_fitness", "2026-09-30", 45, "min"),
  metric("whoop.workout.strain.functional_fitness", "2026-09-30", 10.2),
  metric("whoop.cycle.strain", "2026-09-30", 14),
];

/** Oura: two walks on 29 Sep under one key, and a ride on 5 Sep. */
const OURA_METRICS = [
  metric("workout.duration.cycling", "2026-09-05", 90, "min"),
  metric("workout.calories.cycling", "2026-09-05", 600, "kcal"),
  metric("workout.duration.walking", "2026-09-29", 50, "min"),
  metric("workout.calories.walking", "2026-09-29", 200, "kcal"),
  metric("workout.distance.walking", "2026-09-29", 4000, "m"),
  metric("workout.duration.walking", "2026-09-29", 10, "min"),
  metric("workout.calories.walking", "2026-09-29", 40, "kcal"),
];

const snapshot = (metrics: readonly ReturnType<typeof metric>[]) => ({
  window: { startDate: "2026-09-01", endDate: "2026-10-04" },
  metrics,
  narrative: "synthetic",
});

const LINKED: WearableSummaries = {
  oura: snapshot(OURA_METRICS),
  whoop: snapshot(WHOOP_METRICS),
  googleHealth: null,
  vitronic: null,
};

const WEEK = { start: "2026-09-28", end: "2026-10-04" };
const LABEL = "recent load compared with the previous four weeks";
const RECENT = { start: "2026-09-28", end: "2026-10-04" };
const PREVIOUS = { start: "2026-08-31", end: "2026-09-27" };

describe("the load maths", () => {
  test("weeks start on Monday", () => {
    expect(weekStart("2026-09-28")).toBe("2026-09-28");
    expect(weekStart("2026-10-04")).toBe("2026-09-28");
    expect(weekStart("2026-10-01")).toBe("2026-09-28");
  });

  test("recent minutes against a quarter of the previous four weeks; none before is null", () => {
    expect(recentLoadRatio(60, 240)).toBe(1);
    expect(recentLoadRatio(90, 120)).toBe(3);
    expect(recentLoadRatio(60, 0)).toBeNull();
  });

  test("sport groups", () => {
    expect(
      ["running", "functional_fitness", "walking", "Cycling", "swimming", "yoga"].map(
        sportGroup,
      ),
    ).toEqual(["running", "strength", "walking", "cycling", "swimming", "other"]);
  });
});

describe("training_load, personal snapshots", () => {
  test("one week, per source and sport, audited with 10 values", async () => {
    const { ports, audits } = fakePorts();
    const input = { source: "all" as const, aggregation: "week" as const, ...WEEK };
    const result = await runTrainingLoad(personal, input, ports, LINKED);
    expect(result).toEqual({
      start: "2026-09-28",
      end: "2026-10-04",
      aggregation: "week",
      sport: null,
      // Oura: 2 durations, 2 calories; Whoop: 3 durations, 3 strains.
      n: 10,
      periods: [
        {
          source: "oura",
          period_start: "2026-09-28",
          sport: "walking",
          sport_group: "walking",
          sessions: 2,
          minutes: 60,
          max_strain: null,
          calories: 240,
        },
        {
          source: "whoop",
          period_start: "2026-09-28",
          sport: "functional_fitness",
          sport_group: "strength",
          sessions: 1,
          minutes: 45,
          max_strain: 10.2,
          calories: null,
        },
        {
          source: "whoop",
          period_start: "2026-09-28",
          sport: "running",
          sport_group: "running",
          sessions: 2,
          minutes: 50,
          max_strain: 8.5,
          calories: null,
        },
      ],
      sources: [
        {
          source: "oura",
          sessions: 2,
          minutes: 60,
          recent_load: {
            label: LABEL,
            recent: { ...RECENT, minutes: 60 },
            previous: { ...PREVIOUS, minutes: 90 },
            ratio: (60 * 4) / 90,
          },
        },
        {
          source: "whoop",
          sessions: 3,
          minutes: 95,
          recent_load: {
            label: LABEL,
            recent: { ...RECENT, minutes: 95 },
            previous: { ...PREVIOUS, minutes: 60 },
            ratio: (95 * 4) / 60,
          },
        },
      ],
    });
    expect(audits).toEqual([
      {
        actor: "local",
        sessionId: "turn",
        subjectRef: null,
        tool: "training_load",
        args: input,
        result,
        rowCount: 10,
      },
    ]);
  });

  test("per day, running only", async () => {
    const { ports } = fakePorts();
    const input = {
      source: "whoop" as const,
      aggregation: "day" as const,
      sport: "running" as const,
      ...WEEK,
    };
    expect(await runTrainingLoad(personal, input, ports, LINKED)).toEqual({
      start: "2026-09-28",
      end: "2026-10-04",
      aggregation: "day",
      sport: "running",
      n: 4,
      periods: [
        {
          source: "whoop",
          period_start: "2026-09-28",
          sport: "running",
          sport_group: "running",
          sessions: 2,
          minutes: 50,
          max_strain: 8.5,
          calories: null,
        },
      ],
      sources: [
        {
          source: "whoop",
          sessions: 2,
          minutes: 50,
          recent_load: {
            label: LABEL,
            recent: { ...RECENT, minutes: 50 },
            previous: { ...PREVIOUS, minutes: 60 },
            ratio: (50 * 4) / 60,
          },
        },
      ],
    });
  });

  test("no swimming in the window is NO_ROWS", async () => {
    const { ports } = fakePorts();
    const input = {
      source: "all" as const,
      aggregation: "week" as const,
      sport: "swimming" as const,
      ...WEEK,
    };
    expect(await runTrainingLoad(personal, input, ports, LINKED)).toEqual({
      code: "NO_ROWS",
      error: "no reading of this measure from this source in this window",
      measure: "workouts",
      source: "all",
    });
  });

  test("Oura calories in kJ are MIXED_UNITS, not converted", async () => {
    const { ports } = fakePorts();
    const wearables = {
      ...LINKED,
      oura: snapshot([
        ...OURA_METRICS,
        metric("workout.calories.walking", "2026-09-30", 400, "kJ"),
      ]),
    };
    const input = { source: "oura" as const, aggregation: "week" as const, ...WEEK };
    expect(await runTrainingLoad(personal, input, ports, wearables)).toEqual({
      code: "MIXED_UNITS",
      error:
        "this source's readings of this measure are not all in the one unit the tool reports",
      measure: "workout.calories",
      source: "oura",
      units: ["kJ", "kcal"],
    });
  });

  test("Google not linked is SOURCE_NOT_CONNECTED", async () => {
    const { ports, audits } = fakePorts();
    const input = { source: "google" as const, aggregation: "day" as const, ...WEEK };
    expect(await runTrainingLoad(personal, input, ports, LINKED)).toEqual({
      code: "SOURCE_NOT_CONNECTED",
      error: "this wearable is not linked for this turn",
      source: "google",
      available: ["oura", "whoop"],
    });
    expect(audits.map((audit) => audit.rowCount)).toEqual([0]);
  });
});

describe("training_load, synthetic series", () => {
  const row = (loinc: string, date: string, value: number): FakeRow => ({
    subjectRef: SUBJECT,
    loinc,
    value,
    unitUcum: "min",
    effectiveAt: new Date(`${date}T18:00:00.000Z`),
  });
  const SERIES = [
    row("workout-cycling", "2026-09-07", 60),
    row("workout-cycling", "2026-09-14", 60),
    row("workout-running", "2026-09-29", 40),
    row("workout-strength", "2026-10-02", 45),
    row("93832-4", "2026-09-29", 420),
  ];
  const INPUT = {
    subject_ref: SUBJECT,
    source: "all" as const,
    aggregation: "week" as const,
    ...WEEK,
  };

  test("reads the workout codes from the four weeks before, source synthetic", async () => {
    const { ports, queries, audits } = fakePorts(SERIES);
    expect(await runTrainingLoad(synthetic, INPUT, ports)).toEqual({
      start: "2026-09-28",
      end: "2026-10-04",
      aggregation: "week",
      sport: null,
      n: 2,
      periods: [
        {
          source: "synthetic",
          period_start: "2026-09-28",
          sport: "running",
          sport_group: "running",
          sessions: 1,
          minutes: 40,
          max_strain: null,
          calories: null,
        },
        {
          source: "synthetic",
          period_start: "2026-09-28",
          sport: "strength",
          sport_group: "strength",
          sessions: 1,
          minutes: 45,
          max_strain: null,
          calories: null,
        },
      ],
      sources: [
        {
          source: "synthetic",
          sessions: 2,
          minutes: 85,
          recent_load: {
            label: LABEL,
            recent: { ...RECENT, minutes: 85 },
            previous: { ...PREVIOUS, minutes: 120 },
            ratio: (85 * 4) / 120,
          },
        },
      ],
    });
    expect(queries).toEqual([
      {
        subjectRef: SUBJECT,
        loinc: [
          "workout-running",
          "workout-cycling",
          "workout-walking",
          "workout-strength",
        ],
        start: new Date("2026-08-31T00:00:00.000Z"),
        end: new Date("2026-10-04T23:59:59.999Z"),
        take: 5001,
      },
    ]);
    expect(audits.map((audit) => [audit.subjectRef, audit.rowCount])).toEqual([
      [SUBJECT, 2],
    ]);
  });

  test("no workout in the window is NO_ROWS, even with some before it", async () => {
    const { ports } = fakePorts(SERIES);
    expect(
      await runTrainingLoad(
        synthetic,
        { ...INPUT, start: "2026-09-15", end: "2026-09-27" },
        ports,
      ),
    ).toEqual({
      code: "NO_ROWS",
      error: "no reading of this measure from this source in this window",
      measure: "workouts",
      source: "all",
    });
  });

  test("scope first: personal mode and a missing subject read nothing", async () => {
    const { ports, queries } = fakePorts(SERIES);
    expect(await runTrainingLoad(personal, INPUT, ports, LINKED)).toEqual(
      SUBJECT_SCOPE_VIOLATION,
    );
    const { subject_ref: _, ...withoutSubject } = INPUT;
    expect(await runTrainingLoad(synthetic, withoutSubject, ports)).toEqual(
      SUBJECT_SCOPE_VIOLATION,
    );
    expect(queries).toEqual([]);
  });

  test("a read that throws is still audited with 0 rows and no message", async () => {
    const { ports: base, audits } = fakePorts(SERIES);
    const ports: QueryToolPorts = {
      ...base,
      findObservations: () => Promise.reject(new Error("synthetic database down")),
    };
    await expect(runTrainingLoad(synthetic, INPUT, ports)).rejects.toThrow(
      "synthetic database down",
    );
    expect(audits.map((audit) => [audit.result, audit.rowCount])).toEqual([
      [QUERY_TOOL_FAILED, 0],
    ]);
  });
});
