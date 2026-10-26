import { describe, expect, test } from "bun:test";

import { dayKey, utcDay } from "./day-key";

describe("dayKey", () => {
  test("keeps the date part as sent, unknown when missing", () => {
    expect(dayKey("2026-03-04T23:30:00-05:00")).toBe("2026-03-04");
    expect(dayKey(undefined)).toBe("unknown");
    expect(dayKey(null)).toBe("unknown");
    expect(dayKey("")).toBe("unknown");
  });
});

describe("utcDay", () => {
  test("is the UTC calendar day", () => {
    expect(utcDay(new Date("2026-03-04T23:30:00-05:00"))).toBe("2026-03-05");
  });
});
