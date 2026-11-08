import { describe, expect, test } from "bun:test";

import { isTimeZone, localClock, minutesAfterEvening, nightOf } from "./local-clock";

const clock = (iso: string, zone = "UTC") => {
  const c = localClock(iso, zone);
  return c ? { date: c.date, minutes: c.minutes } : null;
};

describe("localClock", () => {
  test("a time with an offset is read as written", () => {
    expect(clock("2026-11-06T23:10:00+01:00", "America/New_York")).toEqual({
      date: "2026-11-06",
      minutes: 23 * 60 + 10,
    });
    expect(clock("2026-07-07T07:51:29.000-07:00")).toEqual({
      date: "2026-07-07",
      minutes: 7 * 60 + 51,
    });
  });

  test("a UTC time is put on the viewer's zone, summer and winter", () => {
    expect(clock("2026-01-01T23:10:00.000Z", "Europe/Zurich")).toEqual({
      date: "2026-01-02",
      minutes: 10,
    });
    expect(clock("2026-07-01T23:10:00Z", "Europe/Zurich")).toEqual({
      date: "2026-07-02",
      minutes: 70,
    });
    expect(clock("2026-07-01T03:00:00Z", "America/Los_Angeles")).toEqual({
      date: "2026-06-30",
      minutes: 20 * 60,
    });
  });

  test("across the spring change, UTC hours land on the new local hour", () => {
    // Europe/Zurich goes from 02:00 to 03:00 on 29 Mar 2026 (01:00 UTC).
    expect(clock("2026-03-29T00:30:00Z", "Europe/Zurich")).toEqual({
      date: "2026-03-29",
      minutes: 90,
    });
    expect(clock("2026-03-29T01:30:00Z", "Europe/Zurich")).toEqual({
      date: "2026-03-29",
      minutes: 3 * 60 + 30,
    });
  });

  test("across the autumn change, the repeated hour is read twice", () => {
    // Europe/Zurich goes from 03:00 back to 02:00 on 25 Oct 2026 (01:00 UTC).
    expect(clock("2026-10-25T00:30:00Z", "Europe/Zurich")).toEqual({
      date: "2026-10-25",
      minutes: 2 * 60 + 30,
    });
    expect(clock("2026-10-25T01:30:00Z", "Europe/Zurich")).toEqual({
      date: "2026-10-25",
      minutes: 2 * 60 + 30,
    });
  });

  test("a time without a zone is read as UTC on the viewer's zone", () => {
    expect(clock("2026-01-01T12:00:00", "Asia/Tokyo")).toEqual({
      date: "2026-01-01",
      minutes: 21 * 60,
    });
  });

  test("text that is not a time is null", () => {
    expect(localClock("2026-01-01", "UTC")).toBeNull();
    expect(localClock("yesterday", "UTC")).toBeNull();
    expect(localClock(undefined, "UTC")).toBeNull();
  });
});

describe("isTimeZone", () => {
  test("knows IANA zones and refuses anything else", () => {
    expect(isTimeZone("Europe/Zurich")).toBe(true);
    expect(isTimeZone("UTC")).toBe(true);
    expect(isTimeZone("Mars/Olympus")).toBe(false);
    expect(isTimeZone("")).toBe(false);
  });
});

describe("bedtimes across midnight", () => {
  test("minutes after 6 PM keep the evening and the small hours in order", () => {
    expect(minutesAfterEvening(18 * 60)).toBe(0);
    expect(minutesAfterEvening(23 * 60 + 10)).toBe(310);
    expect(minutesAfterEvening(30)).toBe(390);
    expect(minutesAfterEvening(17 * 60 + 59)).toBe(1439);
  });

  test("a night is named by the morning it ends on", () => {
    const at = (date: string, minutes: number) => nightOf({ date, minutes, epochMs: 0 });
    expect(at("2026-01-01", 23 * 60 + 40)).toBe("2026-01-02");
    expect(at("2026-01-02", 25)).toBe("2026-01-02");
    expect(at("2026-01-31", 18 * 60)).toBe("2026-02-01");
    expect(at("2026-01-02", 14 * 60)).toBe("2026-01-02");
  });
});
