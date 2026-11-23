import { describe, expect, test } from "bun:test";

import {
  inLocalDay,
  isCalendarDay,
  isTimeZone,
  localClock,
  localDayBounds,
  offsetMinutes,
} from "./local-time";

describe("isCalendarDay and isTimeZone", () => {
  test("a real date passes; a made-up one or another format does not", () => {
    expect(isCalendarDay("2026-10-25")).toBe(true);
    expect(isCalendarDay("2028-02-29")).toBe(true);
    expect(isCalendarDay("2026-02-29")).toBe(false);
    expect(isCalendarDay("2026-13-01")).toBe(false);
    expect(isCalendarDay("25.10.2026")).toBe(false);
  });

  test("IANA zones pass; a typo does not", () => {
    expect(isTimeZone("Europe/Berlin")).toBe(true);
    expect(isTimeZone("UTC")).toBe(true);
    expect(isTimeZone("Europe/Berlinn")).toBe(false);
    expect(isTimeZone("America/Argentina/Buenos_Aires")).toBe(true);
    expect(isTimeZone("America/Port-au-Prince")).toBe(true);
    expect(isTimeZone("Etc/GMT+1")).toBe(true);
  });

  test("an offset or another spelling of a zone is not a zone name", () => {
    expect(isTimeZone("+01:00")).toBe(false);
    expect(isTimeZone("europe/berlin")).toBe(false);
    expect(isTimeZone("utc")).toBe(false);
  });
});

describe("localDayBounds", () => {
  test("an ordinary Berlin day is 24 hours from local midnight", () => {
    const bounds = localDayBounds("2026-10-20", "Europe/Berlin");
    expect(bounds.start.toISOString()).toBe("2026-10-19T22:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2026-10-20T22:00:00.000Z");
    expect(bounds.hours).toBe(24);
  });

  test("the autumn change in Berlin (25 Oct 2026) has 25 hours", () => {
    const bounds = localDayBounds("2026-10-25", "Europe/Berlin");
    expect(bounds.start.toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2026-10-25T23:00:00.000Z");
    expect(bounds.hours).toBe(25);
  });

  test("the spring change in Berlin (29 Mar 2026) has 23 hours", () => {
    const bounds = localDayBounds("2026-03-29", "Europe/Berlin");
    expect(bounds.start.toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2026-03-29T22:00:00.000Z");
    expect(bounds.hours).toBe(23);
  });

  test("New York changes on another day (1 Nov 2026) and London on the same as Berlin", () => {
    expect(localDayBounds("2026-11-01", "America/New_York").hours).toBe(25);
    expect(localDayBounds("2026-10-25", "America/New_York").hours).toBe(24);
    expect(localDayBounds("2026-10-25", "Europe/London").hours).toBe(25);
    expect(localDayBounds("2026-10-25", "UTC").hours).toBe(24);
  });

  test("the end is outside the day; the instant before it is inside", () => {
    const bounds = localDayBounds("2026-10-25", "Europe/Berlin");
    expect(inLocalDay(bounds.start, bounds)).toBe(true);
    expect(inLocalDay(new Date(bounds.end.getTime() - 1), bounds)).toBe(true);
    expect(inLocalDay(bounds.end, bounds)).toBe(false);
  });
});

describe("localClock", () => {
  test("02:30 happens twice on the autumn change; the offset tells them apart", () => {
    const first = localClock(new Date("2026-10-25T00:30:00Z"), "Europe/Berlin");
    const second = localClock(new Date("2026-10-25T01:30:00Z"), "Europe/Berlin");
    expect(first).toEqual({ day: "2026-10-25", time: "02:30", offset: "+02:00" });
    expect(second).toEqual({ day: "2026-10-25", time: "02:30", offset: "+01:00" });
  });

  test("a UTC instant late in the evening is already the next local day in Berlin", () => {
    expect(localClock(new Date("2026-10-20T22:30:00Z"), "Europe/Berlin").day).toBe(
      "2026-10-21",
    );
    expect(localClock(new Date("2026-10-20T22:30:00Z"), "UTC").day).toBe("2026-10-20");
  });

  test("offsets west of UTC are negative", () => {
    expect(offsetMinutes(new Date("2026-07-01T12:00:00Z"), "America/New_York")).toBe(
      -240,
    );
    expect(localClock(new Date("2026-07-01T12:00:00Z"), "America/New_York").offset).toBe(
      "-04:00",
    );
  });
});
