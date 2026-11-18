import { describe, expect, test } from "bun:test";

import { belongsTo, DEMO_NOTICE, replayDaySchema, replayKeyOf } from "./replay-day";

const KEY = {
  subject_ref: "synthetic-replay-a",
  day: "2026-10-25",
  time_zone: "Europe/Berlin",
} as const;

const SCOPE = { ...KEY, origin: "synthetic_demo" } as const;

const reading = (id: string, at: string, value: number) =>
  ({
    ...SCOPE,
    id,
    stream: "heart_rate",
    unit: "/min",
    at,
    interval_min: 15,
    provenance: "measured",
    source: { kind: "device", name: "Synthetic ring" },
    availability: "available",
    value,
  }) as const;

const DAY = {
  ...SCOPE,
  notice: DEMO_NOTICE,
  readings: [
    reading("first", "2026-10-24T22:00:00Z", 54),
    reading("last", "2026-10-25T22:45:00Z", 58),
  ],
  events: [
    {
      ...SCOPE,
      id: "sleep",
      kind: "sleep",
      label: "Sleep",
      from: "2026-10-24T20:30:00Z",
      to: "2026-10-25T05:30:00Z",
      provenance: "measured",
      source: { kind: "device", name: "Synthetic ring" },
    },
  ],
  narrations: [],
} as const;

const messages = (input: unknown): readonly string[] => {
  const result = replayDaySchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
};

describe("a replay day", () => {
  test("a synthetic day on the 25-hour autumn change parses, sleep from the night before included", () => {
    expect(messages(DAY)).toEqual([]);
  });

  test("a reading in the 25th hour is inside the day; one at the next midnight is not", () => {
    expect(
      messages({
        ...DAY,
        readings: [...DAY.readings, reading("next", "2026-10-25T23:00:00Z", 57)],
      }),
    ).toEqual(["next is outside 2026-10-25 in Europe/Berlin"]);
  });

  test("an item of another person, day or zone is refused, never shown with this day", () => {
    expect(
      messages({
        ...DAY,
        readings: [
          ...DAY.readings,
          {
            ...reading("other-person", "2026-10-25T10:00:00Z", 70),
            subject_ref: "synthetic-replay-b",
          },
          { ...reading("other-day", "2026-10-25T10:15:00Z", 70), day: "2026-10-24" },
          { ...reading("other-zone", "2026-10-25T10:30:00Z", 70), time_zone: "UTC" },
        ],
      }),
    ).toEqual([
      "other-person is about another person, day or time zone",
      "other-day is about another person, day or time zone",
      "other-zone is about another person, day or time zone",
    ]);
  });

  test("recorded and synthetic items never share a day", () => {
    expect(
      messages({
        ...DAY,
        readings: [
          ...DAY.readings,
          { ...reading("recorded", "2026-10-25T10:00:00Z", 70), origin: "recorded" },
        ],
      }),
    ).toEqual(["recorded is recorded, the day is synthetic_demo"]);
  });

  test("a synthetic day carries its notice", () => {
    expect(messages({ ...DAY, notice: null })).toEqual([
      "a synthetic demonstration day carries its notice",
    ]);
  });

  test("one id per item, and one value per stream and instant", () => {
    expect(
      messages({
        ...DAY,
        readings: [...DAY.readings, reading("again", "2026-10-24T22:00:00Z", 60)],
      }),
    ).toEqual([
      "two readings of one stream at one instant: heart_rate 2026-10-24T22:00:00.000Z",
    ]);
    expect(
      messages({
        ...DAY,
        readings: [...DAY.readings, reading("first", "2026-10-25T12:00:00Z", 60)],
      }),
    ).toEqual(["two items share the id first"]);
  });

  test("an event that ends before the day starts is refused", () => {
    expect(
      messages({
        ...DAY,
        events: [
          {
            ...DAY.events[0],
            id: "old-sleep",
            from: "2026-10-23T21:00:00Z",
            to: "2026-10-24T05:00:00Z",
          },
        ],
      }),
    ).toEqual(["old-sleep does not touch 2026-10-25 in Europe/Berlin"]);
  });

  test("an event that ends at the day's first midnight belongs to the day before; one at it, to this day", () => {
    expect(
      messages({
        ...DAY,
        events: [
          {
            ...DAY.events[0],
            id: "late-tag",
            kind: "tag",
            label: "Reading",
            from: "2026-10-24T21:30:00Z",
            to: "2026-10-24T22:00:00Z",
            provenance: "entered",
            source: { kind: "person", name: "Entered by the demo person" },
          },
        ],
      }),
    ).toEqual(["late-tag does not touch 2026-10-25 in Europe/Berlin"]);
    expect(
      messages({
        ...DAY,
        events: [
          {
            ...DAY.events[0],
            id: "midnight-tag",
            kind: "tag",
            label: "Reading",
            from: "2026-10-24T22:00:00Z",
            to: "2026-10-24T22:00:00Z",
            provenance: "entered",
            source: { kind: "person", name: "Entered by the demo person" },
          },
        ],
      }),
    ).toEqual([]);
  });
});

describe("replay keys", () => {
  test("equal only for the same person, day and zone", () => {
    expect(belongsTo({ ...KEY }, KEY)).toBe(true);
    expect(belongsTo({ ...KEY, day: "2026-10-26" }, KEY)).toBe(false);
    expect(belongsTo({ ...KEY, subject_ref: "synthetic-replay-b" }, KEY)).toBe(false);
    expect(belongsTo({ ...KEY, time_zone: "Europe/London" }, KEY)).toBe(false);
  });

  test("a separator inside a name cannot make two keys equal", () => {
    expect(
      replayKeyOf({ subject_ref: "a|2026-10-25", day: "2026-10-26", time_zone: "UTC" }),
    ).not.toBe(
      replayKeyOf({ subject_ref: "a", day: "2026-10-25|2026-10-26", time_zone: "UTC" }),
    );
  });
});
