import { describe, expect, test } from "bun:test";

import {
  monthsBefore,
  parsePeriod,
  PERIOD_PATTERN,
  resolvePeriod,
  todayOf,
} from "./relative-window";
import { trendInput, windowSchema } from "./schemas";

const utc = (iso: string) => ({ now: new Date(iso), timeZone: "UTC" });

const days = (period: string, iso: string) => {
  const window = resolvePeriod(period, utc(iso));
  return [window.first_day, window.last_day];
};

describe("periods", () => {
  test("the forms the schema takes, any case, spaces or underscores", () => {
    expect(
      [
        "last 3 months",
        "last_3_months",
        "LAST 1 YEAR",
        "last 7 days",
        "last 1 day",
        "last 2 weeks",
        "last 999 days",
        "this year",
        "this_year",
        "all",
        "All",
      ].every((period) => PERIOD_PATTERN.test(period)),
    ).toBe(true);
    expect(
      [
        "last 0 days",
        "last 1000 days",
        "last 3 fortnights",
        "last month",
        "recently",
        "since last visit",
        "2026-01-01",
        "",
      ].some((period) => PERIOD_PATTERN.test(period)),
    ).toBe(false);
    expect(parsePeriod("last_3_months")).toEqual({
      kind: "last",
      count: 3,
      unit: "month",
    });
    expect(parsePeriod("This_Year")).toEqual({ kind: "this_year" });
    expect(parsePeriod("ALL")).toEqual({ kind: "all" });
    expect(parsePeriod("recently")).toBeNull();
  });

  test("days and weeks count today and the days before it", () => {
    expect(days("last 1 day", "2026-11-18T10:00:00Z")).toEqual([
      "2026-11-18",
      "2026-11-18",
    ]);
    expect(days("last 7 days", "2026-11-18T10:00:00Z")).toEqual([
      "2026-11-12",
      "2026-11-18",
    ]);
    expect(days("last 2 weeks", "2026-11-18T10:00:00Z")).toEqual([
      "2026-11-05",
      "2026-11-18",
    ]);
    // Across a year end.
    expect(days("last 10 days", "2026-01-03T00:00:00Z")).toEqual([
      "2025-12-25",
      "2026-01-03",
    ]);
  });

  test("months start the day after the same date back, a missing date taken as the month's last", () => {
    expect(days("last 3 months", "2026-11-18T10:00:00Z")).toEqual([
      "2026-08-19",
      "2026-11-18",
    ]);
    // 31 May less 3 months is 28 February (29 in a leap year), so the window starts on 1 March.
    expect(days("last 3 months", "2026-05-31T12:00:00Z")).toEqual([
      "2026-03-01",
      "2026-05-31",
    ]);
    expect(days("last 3 months", "2028-05-31T12:00:00Z")).toEqual([
      "2028-03-01",
      "2028-05-31",
    ]);
    expect(days("last 1 month", "2026-03-31T12:00:00Z")).toEqual([
      "2026-03-01",
      "2026-03-31",
    ]);
    expect(days("last 1 month", "2026-03-30T12:00:00Z")).toEqual([
      "2026-03-01",
      "2026-03-30",
    ]);
    expect(days("last 1 month", "2026-02-28T12:00:00Z")).toEqual([
      "2026-01-29",
      "2026-02-28",
    ]);
    // Back across a year end.
    expect(days("last 2 months", "2026-01-15T12:00:00Z")).toEqual([
      "2025-11-16",
      "2026-01-15",
    ]);
    expect(monthsBefore("2026-12-31", 10)).toBe("2026-02-28");
    expect(monthsBefore("2026-01-31", 13)).toBe("2024-12-31");
  });

  test("years, a leap day included", () => {
    expect(days("last 1 year", "2026-11-18T10:00:00Z")).toEqual([
      "2025-11-19",
      "2026-11-18",
    ]);
    expect(days("last 1 year", "2028-02-29T10:00:00Z")).toEqual([
      "2027-03-01",
      "2028-02-29",
    ]);
    expect(days("last 4 years", "2028-02-29T10:00:00Z")).toEqual([
      "2024-03-01",
      "2028-02-29",
    ]);
  });

  test("this year and all", () => {
    expect(days("this year", "2026-11-18T10:00:00Z")).toEqual([
      "2026-01-01",
      "2026-11-18",
    ]);
    expect(days("this year", "2026-01-01T00:00:00Z")).toEqual([
      "2026-01-01",
      "2026-01-01",
    ]);
    expect(days("all", "2026-11-18T10:00:00Z")).toEqual(["1900-01-01", "2026-11-18"]);
  });

  test("in UTC the window is plain dates, whole UTC days", () => {
    expect(resolvePeriod("last 3 months", utc("2026-11-18T23:59:59.999Z"))).toEqual({
      period: "last 3 months",
      start: "2026-08-19",
      end: "2026-11-18",
      first_day: "2026-08-19",
      last_day: "2026-11-18",
      time_zone: "UTC",
    });
  });
});

describe("in the subject's time zone", () => {
  test("today is the local day: just after midnight UTC is still yesterday in New York", () => {
    const clock = { now: new Date("2026-01-01T00:30:00Z"), timeZone: "America/New_York" };
    expect(todayOf(clock)).toBe("2025-12-31");
    expect(resolvePeriod("this year", clock)).toEqual({
      period: "this year",
      start: "2025-01-01T05:00:00.000Z",
      end: "2026-01-01T04:59:59.999Z",
      first_day: "2025-01-01",
      last_day: "2025-12-31",
      time_zone: "America/New_York",
    });
  });

  test("autumn change: Berlin's 25 October 2026 has 25 hours", () => {
    const window = resolvePeriod("last 2 days", {
      now: new Date("2026-10-26T12:00:00Z"),
      timeZone: "Europe/Berlin",
    });
    // Local midnight in summer time (+02:00) to the end of the day in winter time (+01:00).
    expect([window.start, window.end]).toEqual([
      "2026-10-24T22:00:00.000Z",
      "2026-10-26T22:59:59.999Z",
    ]);
    const hours = (Date.parse(window.end) + 1 - Date.parse(window.start)) / 3_600_000;
    expect(hours).toBe(49);
  });

  test("spring change: Berlin's 29 March 2026 has 23 hours", () => {
    const window = resolvePeriod("last 1 day", {
      now: new Date("2026-03-29T12:00:00Z"),
      timeZone: "Europe/Berlin",
    });
    expect([window.start, window.end]).toEqual([
      "2026-03-28T23:00:00.000Z",
      "2026-03-29T21:59:59.999Z",
    ]);
    expect((Date.parse(window.end) + 1 - Date.parse(window.start)) / 3_600_000).toBe(23);
  });

  test("a month back in a zone east of UTC keeps local month ends", () => {
    const window = resolvePeriod("last 1 month", {
      now: new Date("2026-03-30T23:30:00Z"),
      timeZone: "Asia/Tokyo",
    });
    // 08:30 on 31 March in Tokyo.
    expect([window.first_day, window.last_day]).toEqual(["2026-03-01", "2026-03-31"]);
    expect(window.start).toBe("2026-02-28T15:00:00.000Z");
  });
});

describe("the window schemas", () => {
  const base = { subject_ref: "s", loinc: "4548-4" };

  test("start and end, or period, never both and never neither", () => {
    expect(
      trendInput.safeParse({ ...base, start: "2026-01-01", end: "2026-02-01" }).success,
    ).toBe(true);
    expect(trendInput.safeParse({ ...base, period: "last 3 months" }).success).toBe(true);
    expect(
      trendInput.safeParse({ ...base, period: "last 3 months", start: "2026-01-01" })
        .success,
    ).toBe(false);
    expect(trendInput.safeParse({ ...base, start: "2026-01-01" }).success).toBe(false);
    expect(trendInput.safeParse(base).success).toBe(false);
    expect(trendInput.safeParse({ ...base, period: "recently" }).success).toBe(false);
  });

  test("windowSchema takes a period too, and still checks start before end", () => {
    expect(windowSchema.safeParse({ period: "this year" }).success).toBe(true);
    expect(
      windowSchema.safeParse({ start: "2026-02-01", end: "2026-01-01" }).success,
    ).toBe(false);
    expect(windowSchema.safeParse({}).success).toBe(false);
  });
});
