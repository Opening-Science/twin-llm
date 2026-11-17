import { describe, expect, test } from "bun:test";

import EXAMPLE from "@/docs/kiosk-day.example.json";

import {
  dayUrl,
  MOCK_CHOICE,
  parseDay,
  parseDayList,
  parseError,
  parsePeriod,
  periodUrl,
  pickChoice,
} from "./day-view";

const DAYS = [
  { day: "2026-11-16", readings: 26 },
  { day: "2026-11-15", readings: 1 },
];

describe("parseDayList", () => {
  test("reads a days body", () => {
    expect(parseDayList({ days: DAYS })).toEqual(DAYS);
  });

  test("refuses anything else", () => {
    expect(parseDayList(null)).toBeNull();
    expect(parseDayList({ days: [{ day: "yesterday", readings: 1 }] })).toBeNull();
    expect(parseDayList({ error: "x" })).toBeNull();
  });
});

describe("parseDay", () => {
  test("reads a kiosk day that keeps the contract", () => {
    expect(parseDay({ day: EXAMPLE })?.subject_ref).toBe(EXAMPLE.subject_ref);
  });

  test("refuses a narrated beat with a value", () => {
    const beats = EXAMPLE.beats.map((beat) =>
      beat.source === "narrated" ? { ...beat, value: 12, unit: "mg/dL" } : beat,
    );
    expect(parseDay({ day: { ...EXAMPLE, beats } })).toBeNull();
  });
});

describe("parseError", () => {
  test("reads the route's sentence, nothing else", () => {
    expect(parseError({ error: "No synthetic day for this person." })).toBe(
      "No synthetic day for this person.",
    );
    expect(parseError({ error: { stack: "x" } })).toBeNull();
  });
});

describe("pickChoice", () => {
  test("starts on the newest day", () => {
    expect(pickChoice(DAYS, null)).toBe("2026-11-16");
  });

  test("keeps a listed day and the mock", () => {
    expect(pickChoice(DAYS, "2026-11-15")).toBe("2026-11-15");
    expect(pickChoice(DAYS, MOCK_CHOICE)).toBe(MOCK_CHOICE);
  });

  test("a day another person had falls back to the newest", () => {
    expect(pickChoice(DAYS, "2026-01-01")).toBe("2026-11-16");
  });

  test("with no days, or a failed list, it is the mock", () => {
    expect(pickChoice([], null)).toBe(MOCK_CHOICE);
    expect(pickChoice(null, null)).toBe(MOCK_CHOICE);
  });
});

describe("dayUrl", () => {
  test("the mock reads no person", () => {
    expect(dayUrl(MOCK_CHOICE, "syn a", "with_diabetes")).toBe(
      "/api/digital-twin/day?profile=with_diabetes",
    );
  });

  test("a person's day names them, encoded", () => {
    expect(dayUrl("2026-11-16", "syn a", "without_diabetes")).toBe(
      "/api/digital-twin/day/syn%20a?day=2026-11-16&profile=without_diabetes",
    );
  });
});

describe("parsePeriod and periodUrl", () => {
  const SUMMARY = {
    period: "week",
    start: "2026-11-10",
    end: "2026-11-16",
    title: "Week",
    lines: [{ label: "Blood glucose", text: "Average 103 mg/dL." }],
    notes: [],
  };

  test("reads a summary and refuses extra fields", () => {
    expect(parsePeriod({ period: SUMMARY })?.title).toBe("Week");
    expect(parsePeriod({ period: { ...SUMMARY, raw: [1, 2] } })).toBeNull();
  });

  test("the mock has no period; a person's ends on the chosen day", () => {
    expect(periodUrl(MOCK_CHOICE, "syn-a", "week", "without_diabetes")).toBeNull();
    expect(periodUrl("2026-11-16", "syn a", "month", "with_diabetes")).toBe(
      "/api/digital-twin/period/syn%20a?period=month&end=2026-11-16&profile=with_diabetes",
    );
  });
});
