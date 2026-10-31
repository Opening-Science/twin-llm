import { describe, expect, test } from "bun:test";

import {
  describeSchedule,
  dueDecision,
  instantOfWallClock,
  isTimeZone,
  nextRunAfter,
  type Schedule,
  scheduleSchema,
} from "./schedule";

const ZURICH = "Europe/Zurich";
const NEW_YORK = "America/New_York";
const anchor = new Date("2026-01-01T00:00:00Z");
const iso = (date: Date): string => date.toISOString();

const daily = (time: string, timeZone = ZURICH): Schedule => ({
  kind: "daily",
  time,
  timeZone,
});

describe("nextRunAfter", () => {
  test("daily runs later today when the time has not passed", () => {
    // 07:00 in Zurich in winter is 06:00 UTC.
    const next = nextRunAfter(daily("08:00"), new Date("2026-01-15T06:00:00Z"), anchor);
    expect(iso(next)).toBe("2026-01-15T07:00:00.000Z");
  });

  test("daily runs tomorrow when the time has passed or is now", () => {
    const next = nextRunAfter(daily("08:00"), new Date("2026-01-15T07:00:00Z"), anchor);
    expect(iso(next)).toBe("2026-01-16T07:00:00.000Z");
  });

  test("summer time moves the UTC instant, not the wall time", () => {
    const next = nextRunAfter(daily("08:00"), new Date("2026-07-15T00:00:00Z"), anchor);
    expect(iso(next)).toBe("2026-07-15T06:00:00.000Z");
  });

  test("across the spring-forward night the wall time stays 08:00", () => {
    // Europe switches on 29 March 2026 at 01:00 UTC.
    const next = nextRunAfter(daily("08:00"), new Date("2026-03-28T08:00:00Z"), anchor);
    expect(iso(next)).toBe("2026-03-29T06:00:00.000Z");
  });

  test("a time inside the spring-forward gap runs the gap's length later", () => {
    // 02:30 does not exist in Zurich on 29 March 2026; it runs at 03:30 CEST.
    const next = nextRunAfter(daily("02:30"), new Date("2026-03-28T12:00:00Z"), anchor);
    expect(iso(next)).toBe("2026-03-29T01:30:00.000Z");
  });

  test("a time that happens twice on the fall-back night runs at the first", () => {
    // 02:30 happens twice in Zurich on 25 October 2026; the first is CEST.
    const next = nextRunAfter(daily("02:30"), new Date("2026-10-24T12:00:00Z"), anchor);
    expect(iso(next)).toBe("2026-10-25T00:30:00.000Z");
    const after = nextRunAfter(daily("02:30"), next, anchor);
    expect(iso(after)).toBe("2026-10-26T01:30:00.000Z");
  });

  test("New York's own change date is used, not Europe's", () => {
    // US clocks change on 8 March 2026; 09:00 EDT is 13:00 UTC.
    const next = nextRunAfter(
      daily("09:00", NEW_YORK),
      new Date("2026-03-08T12:00:00Z"),
      anchor,
    );
    expect(iso(next)).toBe("2026-03-08T13:00:00.000Z");
  });

  test("weekly runs on its weekday", () => {
    // 15 January 2026 is a Thursday; the next Monday is 19 January.
    const next = nextRunAfter(
      { kind: "weekly", weekday: 1, time: "07:30", timeZone: ZURICH },
      new Date("2026-01-15T12:00:00Z"),
      anchor,
    );
    expect(iso(next)).toBe("2026-01-19T06:30:00.000Z");
  });

  test("weekly on today's weekday after the time waits a full week", () => {
    const next = nextRunAfter(
      { kind: "weekly", weekday: 4, time: "07:30", timeZone: ZURICH },
      new Date("2026-01-15T12:00:00Z"),
      anchor,
    );
    expect(iso(next)).toBe("2026-01-22T06:30:00.000Z");
  });

  test("an interval counts elapsed time from its anchor, through a clock change", () => {
    const every6h: Schedule = { kind: "interval", minutes: 360, timeZone: ZURICH };
    const start = new Date("2026-03-28T22:00:00Z");
    expect(iso(nextRunAfter(every6h, new Date("2026-03-29T03:00:00Z"), start))).toBe(
      "2026-03-29T04:00:00.000Z",
    );
    expect(iso(nextRunAfter(every6h, new Date("2026-03-29T04:00:00Z"), start))).toBe(
      "2026-03-29T10:00:00.000Z",
    );
    expect(iso(nextRunAfter(every6h, new Date("2026-03-28T21:00:00Z"), start))).toBe(
      "2026-03-28T22:00:00.000Z",
    );
  });
});

describe("instantOfWallClock", () => {
  test("an ordinary wall time maps to one instant", () => {
    expect(
      new Date(instantOfWallClock(Date.UTC(2026, 0, 15, 8, 0), ZURICH)).toISOString(),
    ).toBe("2026-01-15T07:00:00.000Z");
  });
});

describe("dueDecision", () => {
  const schedule = daily("08:00");

  test("not due before its next run, or with no next run", () => {
    expect(
      dueDecision(
        schedule,
        new Date("2026-01-15T07:00:00Z"),
        new Date("2026-01-15T06:59:59Z"),
        anchor,
      ),
    ).toEqual({ due: false });
    expect(dueDecision(schedule, null, new Date("2026-01-15T07:00:00Z"), anchor)).toEqual(
      { due: false },
    );
  });

  test("due at its next run, then next the following day", () => {
    expect(
      dueDecision(
        schedule,
        new Date("2026-01-15T07:00:00Z"),
        new Date("2026-01-15T07:00:10Z"),
        anchor,
      ),
    ).toEqual({
      due: true,
      scheduledFor: new Date("2026-01-15T07:00:00Z"),
      missed: 0,
      next: new Date("2026-01-16T07:00:00Z"),
    });
  });

  test("three days down: runs once, counts two missed, next is after now", () => {
    expect(
      dueDecision(
        schedule,
        new Date("2026-01-15T07:00:00Z"),
        new Date("2026-01-17T12:00:00Z"),
        anchor,
      ),
    ).toEqual({
      due: true,
      scheduledFor: new Date("2026-01-15T07:00:00Z"),
      missed: 2,
      next: new Date("2026-01-18T07:00:00Z"),
    });
  });

  test("an interval that missed runs is due once and stays on its grid", () => {
    const every1h: Schedule = { kind: "interval", minutes: 60, timeZone: ZURICH };
    const start = new Date("2026-01-15T00:00:00Z");
    expect(
      dueDecision(
        every1h,
        new Date("2026-01-15T01:00:00Z"),
        new Date("2026-01-15T04:30:00Z"),
        start,
      ),
    ).toEqual({
      due: true,
      scheduledFor: new Date("2026-01-15T01:00:00Z"),
      missed: 3,
      next: new Date("2026-01-15T05:00:00Z"),
    });
  });
});

describe("schedule schema and words", () => {
  test("refuses an unknown zone, a bad time and a zero interval", () => {
    expect(isTimeZone("Europe/Zurich")).toBe(true);
    expect(isTimeZone("Mars/Olympus")).toBe(false);
    expect(scheduleSchema.safeParse(daily("24:00")).success).toBe(false);
    expect(scheduleSchema.safeParse(daily("08:00", "Mars/Olympus")).success).toBe(false);
    expect(
      scheduleSchema.safeParse({ kind: "interval", minutes: 0, timeZone: ZURICH })
        .success,
    ).toBe(false);
    expect(scheduleSchema.safeParse(daily("08:00")).success).toBe(true);
  });

  test("describes each kind", () => {
    expect(describeSchedule(daily("08:00"))).toBe("Daily at 08:00");
    expect(
      describeSchedule({ kind: "weekly", weekday: 1, time: "07:30", timeZone: ZURICH }),
    ).toBe("Mondays at 07:30");
    expect(describeSchedule({ kind: "interval", minutes: 60, timeZone: ZURICH })).toBe(
      "Every hour",
    );
    expect(describeSchedule({ kind: "interval", minutes: 360, timeZone: ZURICH })).toBe(
      "Every 6 hours",
    );
    expect(describeSchedule({ kind: "interval", minutes: 1, timeZone: ZURICH })).toBe(
      "Every minute",
    );
  });
});
