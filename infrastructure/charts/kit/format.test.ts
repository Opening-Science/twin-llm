import { describe, expect, test } from "bun:test";

import { dayAxis, formatClock, formatDuration } from "./format";

describe("durations", () => {
  test("as the insight sentences write them", () => {
    expect(formatDuration(424)).toBe("7 hr 4 min");
    expect(formatDuration(420)).toBe("7 hr");
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(0)).toBe("0 min");
    expect(formatDuration(-30)).toBe("30 min");
    expect(formatDuration(59.6)).toBe("1 hr");
  });
});

describe("clock times", () => {
  test("24-hour in the display locale", () => {
    expect(formatClock(23 * 60 + 48)).toBe("23:48");
    expect(formatClock(7 * 60 + 5)).toBe("07:05");
  });

  test("past midnight or below zero wraps round", () => {
    expect(formatClock(24 * 60 + 30)).toBe("00:30");
    expect(formatClock(-15)).toBe("23:45");
  });

  test("another locale writes its own clock", () => {
    expect(formatClock(23 * 60 + 48, "en-US")).toBe("11:48 PM");
    // A 12-hour clock does not pad the hour; a 24-hour one does.
    expect(formatClock(545, "en-US")).toBe("9:05 AM");
    expect(formatClock(545)).toBe("09:05");
  });
});

describe("the day's axis", () => {
  test("00:00, 12:00 and 24:00 on a 24-hour clock", () => {
    expect(dayAxis()).toEqual(["00:00", "12:00", "24:00"]);
  });

  test("a 12-hour clock writes its own", () => {
    expect(dayAxis("en-US")).toEqual(["12:00 AM", "12:00 PM", "12:00 AM"]);
  });
});
