import { describe, expect, test } from "bun:test";

import { chartSeries, readingAt } from "./at-time";
import {
  DEMO_PERSON_A,
  DEMO_REFERENCE_DAY,
  DEMO_TIME_ZONE,
  demoReplayDay,
} from "./demo-days";
import { localClock, localInstant } from "./local-time";
import { type ReplayDay } from "./replay-day";

const day = (date: string): ReplayDay => {
  const found = demoReplayDay(DEMO_PERSON_A, date);
  if (found === null) throw new Error(`no demo day ${date}`);
  return found;
};

const REFERENCE = day(DEMO_REFERENCE_DAY);
const STALE = day("2026-10-23");
const PARTIAL = day("2026-10-28");
const NOTHING = day("2026-10-22");

const SENSOR = { stream: "glucose", specimen: "sensor" } as const;
const BLOOD = { stream: "glucose", specimen: "blood" } as const;
const HEART = { stream: "heart_rate" } as const;

const local = (date: string, time: string): Date =>
  localInstant(date, time, DEMO_TIME_ZONE);

const clock = (iso: string): string => localClock(new Date(iso), DEMO_TIME_ZONE).time;

describe("readingAt", () => {
  test("between two samples, the last one, with its age", () => {
    const state = readingAt(REFERENCE, SENSOR, local(DEMO_REFERENCE_DAY, "08:20"));
    expect(state.state).toBe("available");
    if (state.state !== "available") return;
    expect(clock(state.reading.at)).toBe("08:15");
    expect(state.age_min).toBe(5);
  });

  test("in the sensor gap, no value and the reason, not the 09:45 value", () => {
    expect(readingAt(REFERENCE, SENSOR, local(DEMO_REFERENCE_DAY, "10:20"))).toEqual({
      state: "unavailable",
      why: "missing",
      text: "No reading: New sensor warming up.",
    });
  });

  test("after the ring stops syncing, the last heart rate is stale, with its age", () => {
    const at2000 = readingAt(STALE, HEART, local("2026-10-23", "20:00"));
    expect(at2000.state).toBe("available");
    const at2200 = readingAt(STALE, HEART, local("2026-10-23", "22:00"));
    expect(at2200.state).toBe("stale");
    if (at2200.state !== "stale") return;
    expect(clock(at2200.reading.at)).toBe("19:45");
    expect(at2200.age_min).toBe(135);
    expect(at2200.stale_after_min).toBe(30);
  });

  test("a stream not worn that day is not recorded, never zero", () => {
    expect(readingAt(PARTIAL, SENSOR, local("2026-10-28", "12:00"))).toEqual({
      state: "unavailable",
      why: "not_recorded",
      text: "Not recorded on this day.",
    });
    expect(readingAt(NOTHING, HEART, local("2026-10-22", "12:00")).state).toBe(
      "unavailable",
    );
  });

  test("before the first reading of a stream, no reading yet", () => {
    expect(readingAt(REFERENCE, BLOOD, local(DEMO_REFERENCE_DAY, "07:00"))).toEqual({
      state: "unavailable",
      why: "not_yet",
      text: "No reading yet at this time.",
    });
  });

  test("blood and sensor glucose are separate series", () => {
    const blood = readingAt(REFERENCE, BLOOD, local(DEMO_REFERENCE_DAY, "07:30"));
    expect(blood.state === "available" && blood.reading.value).toBe(98);
    const later = readingAt(REFERENCE, BLOOD, local(DEMO_REFERENCE_DAY, "09:00"));
    expect(later.state).toBe("stale");
  });

  test("a time on another day is refused, so a cursor never reads the wrong date", () => {
    expect(readingAt(REFERENCE, HEART, local("2026-10-26", "12:00"))).toEqual({
      state: "unavailable",
      why: "outside_day",
      text: "That time is not on 2026-10-27.",
    });
  });
});

describe("chartSeries", () => {
  test("the sensor gap splits the line in two and is listed as missing", () => {
    const chart = chartSeries(REFERENCE, SENSOR);
    expect(chart.segments).toHaveLength(2);
    expect(clock(chart.segments[0]!.at(-1)!.at)).toBe("09:45");
    expect(clock(chart.segments[1]![0]!.at)).toBe("11:00");
    expect(chart.gaps.map((gap) => [clock(gap.from), clock(gap.to), gap.why])).toEqual([
      ["09:45", "11:00", "missing"],
    ]);
  });

  test("the one-minute stretch joins the quarter-hours without a gap", () => {
    const chart = chartSeries(REFERENCE, HEART);
    expect(chart.segments).toHaveLength(1);
    expect(chart.gaps).toEqual([]);
  });

  test("a series that stops early ends in a gap to the day's end", () => {
    const chart = chartSeries(STALE, HEART);
    expect(chart.gaps.map((gap) => [clock(gap.from), clock(gap.to), gap.why])).toEqual([
      ["19:45", "00:00", "no_readings"],
    ]);
  });

  test("a lone blood value is one segment with gaps either side", () => {
    const chart = chartSeries(REFERENCE, BLOOD);
    expect(chart.segments.map((segment) => segment.length)).toEqual([1]);
    expect(chart.gaps.map((gap) => [clock(gap.from), clock(gap.to)])).toEqual([
      ["00:00", "07:25"],
      ["07:25", "00:00"],
    ]);
  });

  test("a stream with no readings has no segments and nothing invented", () => {
    expect(chartSeries(PARTIAL, SENSOR)).toEqual({ segments: [], gaps: [] });
  });
});
