import { describe, expect, test } from "bun:test";

import type { AppendInput } from "@/packages/audit/append";

import type { ObservationRecord, QueryToolPorts, SubjectScopeRow } from "./ports";
import { mixedUnits, ROW_CAP_EXCEEDED } from "./refusals";
import { SUBJECT_SCOPE_VIOLATION, type SessionScope } from "./scope";
import { type ShowMyPeriodResult } from "./show-my-period";
import { runHrvTrend, runRestingHrTrend, runShowMyPeriod } from "./tools";

/**
 * `show_my_period` over a made-up synthetic subject: 40 days of daily resting
 * heart rate and HRV, and three glucose readings a day in the last week.
 * Glucose values are written out by hand; the trends are checked against
 * `resting_hr_trend` and `hrv_trend` on the same rows.
 */

const SUBJECT = "synthetic-show-my-period-subject";
const UNLISTED = "unlisted-cohort-subject";
const END = "2026-11-16";

const SUBJECTS: Readonly<Record<string, SubjectScopeRow>> = {
  [SUBJECT]: { isSynthetic: true, cohortId: "synthea-v4-seed42" },
  [UNLISTED]: { isSynthetic: true, cohortId: "synthea-unlisted" },
};

type FakeRow = ObservationRecord & Readonly<{ subjectRef: string }>;

const dayBefore = (days: number): string =>
  new Date(Date.parse(`${END}T00:00:00.000Z`) - days * 86_400_000)
    .toISOString()
    .slice(0, 10);

const row = (
  loinc: string,
  value: number,
  unitUcum: string,
  day: string,
  time: string,
): FakeRow => ({
  subjectRef: SUBJECT,
  loinc,
  value,
  unitUcum,
  effectiveAt: new Date(`${day}T${time}:00.000Z`),
});

/** Days 39 to 0 before the end: resting heart rate drifts down, HRV up. */
const DAILY: readonly FakeRow[] = Array.from({ length: 40 }, (_, index) => {
  const back = 39 - index;
  const day = dayBefore(back);
  return [
    row("40443-4", 60 + (back % 5), "/min", day, "06:00"),
    row("hrv-rmssd", 45 - (back % 4), "ms", day, "06:00"),
  ];
}).flat();

/** The last 7 days: 90 and 110 mg/dL each day, and 150 after dinner on the last two. */
const GLUCOSE: readonly FakeRow[] = Array.from({ length: 7 }, (_, index) => {
  const day = dayBefore(6 - index);
  return [
    row("2339-0", 90, "mg/dL", day, "07:00"),
    row("2345-7", 110, "mg/dL", day, "13:00"),
    ...(index >= 5 ? [row("2339-0", 150, "mg/dL", day, "20:30")] : []),
  ];
}).flat();

/** A glucose reading the day before the week: read for nothing, never counted. */
const BEFORE_WEEK = row("2339-0", 300, "mg/dL", dayBefore(7), "12:00");

const FIXTURE: readonly FakeRow[] = [...DAILY, ...GLUCOSE, BEFORE_WEEK];

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

const WEEK = {
  subject_ref: SUBJECT,
  period: "week",
  end: END,
  profile: "without_diabetes",
} as const;

const asResult = (value: unknown): ShowMyPeriodResult => value as ShowMyPeriodResult;

describe("show_my_period over a week", () => {
  test("glucose: average and share above 140, the day before the week left out", async () => {
    // Hand-checked: 7 × (90 + 110) + 2 × 150 = 1700 over 16 readings = 106.25.
    const result = asResult(await runShowMyPeriod(synthetic, WEEK, fakePorts().ports));
    expect(result.start).toBe("2026-11-10");
    expect(result.end).toBe(END);
    expect(result.glucose.n).toBe(16);
    expect(result.glucose.days).toBe(7);
    expect(result.glucose.average_mg_dl).toBe(106.3);
    expect(result.glucose.share_of_readings).toEqual({
      below: null,
      within: 0.875,
      above: 0.125,
    });
    expect(result.glucose.by_day.at(-1)).toEqual({
      day: END,
      n: 3,
      average_mg_dl: 116.7,
      below: 0,
      above: 1,
    });
    expect(result.recovery).toBe("not recorded");
    expect(result.thresholds).toEqual({ status: "placeholder", reviewer: "Robin" });
    expect(result.timezone).toBe("UTC");
  });

  test("the trends are what resting_hr_trend and hrv_trend return for the same week", async () => {
    const { ports } = fakePorts();
    const result = asResult(await runShowMyPeriod(synthetic, WEEK, ports));
    const window = {
      subject_ref: SUBJECT,
      source: "all",
      start: "2026-11-10",
      end: END,
    } as const;
    expect(result.resting_hr).toEqual(await runRestingHrTrend(synthetic, window, ports));
    expect(result.hrv).toEqual(await runHrvTrend(synthetic, window, ports));
  });

  test("one capped read of five codes over the week and the 35 days before its end, one audit row", async () => {
    const { ports, audits, queries } = fakePorts();
    const result = asResult(await runShowMyPeriod(synthetic, WEEK, ports));
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatchObject({
      loinc: ["2339-0", "2345-7", "40443-4", "hrv-rmssd"],
      start: new Date("2026-10-13T00:00:00.000Z"),
      end: new Date("2026-11-16T23:59:59.999Z"),
    });
    // 35 days of two daily rows, the 16 glucose readings and the one before the week.
    expect(result.n).toBe(35 * 2 + 16 + 1);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      tool: "show_my_period",
      subjectRef: SUBJECT,
      rowCount: result.n,
    });
  });
});

describe("show_my_period over a month", () => {
  test("covers the 30 days ending on end", async () => {
    const result = asResult(
      await runShowMyPeriod(synthetic, { ...WEEK, period: "month" }, fakePorts().ports),
    );
    expect(result.start).toBe("2026-10-18");
    // The reading the day before the week is inside the month: 17 readings, 8 days.
    expect(result.glucose.n).toBe(17);
    expect(result.glucose.days).toBe(8);
  });

  test("with diabetes: 70–180 mg/dL, so 300 is above and nothing below", async () => {
    const result = asResult(
      await runShowMyPeriod(
        synthetic,
        { ...WEEK, period: "month", profile: "with_diabetes" },
        fakePorts().ports,
      ),
    );
    expect(result.glucose.range).toMatchObject({ low: 70, high: 180 });
    expect(result.glucose.share_of_readings).toEqual({
      below: 0,
      within: 0.941,
      above: 0.059,
    });
  });
});

describe("show_my_period refusals", () => {
  test("scope first: personal mode and an unlisted cohort read nothing", async () => {
    for (const [scope, subject] of [
      [personal, SUBJECT],
      [synthetic, UNLISTED],
    ] as const) {
      const { ports, queries } = fakePorts();
      expect(
        await runShowMyPeriod(scope, { ...WEEK, subject_ref: subject }, ports),
      ).toEqual(SUBJECT_SCOPE_VIOLATION);
      expect(queries).toHaveLength(0);
    }
  });

  test("glucose in another unit is refused, never converted", async () => {
    const { ports } = fakePorts([...FIXTURE, row("2339-0", 5.5, "mmol/L", END, "09:00")]);
    expect(await runShowMyPeriod(synthetic, WEEK, ports)).toEqual(
      mixedUnits("2339-0", ["mg/dL", "mmol/L"]),
    );
  });

  test("a read over the cap is refused", async () => {
    const many = Array.from({ length: 5001 }, (_, index) =>
      row(
        "2339-0",
        100,
        "mg/dL",
        END,
        `${String(Math.floor(index / 60) % 24).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}`,
      ),
    );
    expect(await runShowMyPeriod(synthetic, WEEK, fakePorts(many).ports)).toEqual(
      ROW_CAP_EXCEEDED,
    );
  });
});
