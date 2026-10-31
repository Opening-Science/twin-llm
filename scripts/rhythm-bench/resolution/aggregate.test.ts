import { describe, expect, test } from "bun:test";

import {
  beatFlagShare,
  dailySummary,
  dayFeatures,
  epochSummaries,
  hourFeatures,
  hrJumps,
  type Interval,
  intervalsFromBeats,
  irregularShare,
  MS,
  rmssdOf,
  splitUnits,
  unitNrmssd,
} from "./aggregate";

const iv = (endMs: number, rrMs: number, af = false, run = 0): Interval => ({
  endMs,
  rrMs,
  af,
  run,
});

/** Intervals of constant length from 0 up to `spanMs`. */
const steady = (rrMs: number, spanMs: number): Interval[] =>
  Array.from({ length: Math.floor(spanMs / rrMs) }, (_, i) => iv((i + 1) * rrMs, rrMs));

describe("intervalsFromBeats", () => {
  test("one interval per label, ending at the next beat", () => {
    expect(
      intervalsFromBeats([0, 800, 1500], ["sinus", "af"], (l) => l === "af"),
    ).toEqual([
      { endMs: 800, rrMs: 800, af: false, run: 0 },
      { endMs: 1500, rrMs: 700, af: true, run: 0 },
    ]);
  });
});

describe("rmssdOf and unitNrmssd", () => {
  test("pairs only inside a run", () => {
    // Pairs (800, 1000) and (600, 1000); the 1000 -> 600 step crosses runs.
    const intervals = [
      iv(800, 800),
      iv(1800, 1000),
      iv(5000, 600, false, 1),
      iv(6000, 1000, false, 1),
    ];
    expect(rmssdOf(intervals)).toBe(Math.sqrt((200 ** 2 + 400 ** 2) / 2));
    expect(unitNrmssd(intervals)).toBe(Math.sqrt((200 ** 2 + 400 ** 2) / 2) / 850);
  });

  test("null without a pair", () => {
    expect(rmssdOf([iv(800, 800)])).toBe(null);
    expect(unitNrmssd([])).toBe(null);
  });
});

describe("epochSummaries", () => {
  test("groups by the ending beat and drops sparse epochs", () => {
    const intervals = [iv(400, 400), iv(900, 500, true), iv(1500, 600), iv(2600, 1100)];
    expect(epochSummaries(intervals, 1000, 3000, 2)).toEqual([
      {
        index: 0,
        startMs: 0,
        n: 2,
        meanHr: 60_000 / 450,
        rmssdMs: 100,
        nrmssd: 100 / 450,
        afShare: 0.5,
      },
      {
        index: 1,
        startMs: 1000,
        n: 1,
        meanHr: null,
        rmssdMs: null,
        nrmssd: null,
        afShare: 0,
      },
      {
        index: 2,
        startMs: 2000,
        n: 1,
        meanHr: null,
        rmssdMs: null,
        nrmssd: null,
        afShare: 0,
      },
    ]);
  });

  test("an empty epoch has no AF share", () => {
    expect(epochSummaries([], 1000, 1000)).toEqual([
      {
        index: 0,
        startMs: 0,
        n: 0,
        meanHr: null,
        rmssdMs: null,
        nrmssd: null,
        afShare: null,
      },
    ]);
  });
});

describe("irregularShare and hrJumps", () => {
  const epoch = (meanHr: number | null, nrmssd: number | null) => ({
    index: 0,
    startMs: 0,
    n: 10,
    meanHr,
    rmssdMs: null,
    nrmssd,
    afShare: 0,
  });

  test("share of scored epochs above 0.1", () => {
    expect(irregularShare([epoch(60, 0.05), epoch(60, 0.2), epoch(null, null)])).toBe(
      0.5,
    );
    expect(irregularShare([epoch(null, null)])).toBe(null);
  });

  test("RMS of the change between neighbouring epochs that both have a rate", () => {
    expect(
      hrJumps([
        epoch(60, 0),
        epoch(63, 0),
        epoch(59, 0),
        epoch(null, null),
        epoch(70, 0),
      ]),
    ).toBe(Math.sqrt((9 + 16) / 2));
    expect(hrJumps([epoch(60, 0)])).toBe(null);
  });
});

describe("beatFlagShare", () => {
  test("steady intervals are never flagged; no whole window gives null", () => {
    expect(beatFlagShare(steady(1000, 300_000))).toBe(0);
    expect(beatFlagShare(steady(1000, 100_000))).toBe(null);
  });

  test("windows do not cross runs", () => {
    const twoRuns = [
      ...steady(1000, 100_000),
      ...steady(1000, 100_000).map((each) => ({ ...each, run: 1 })),
    ];
    expect(beatFlagShare(twoRuns)).toBe(null);
  });
});

describe("dailySummary", () => {
  test("night epochs give resting HR and RMSSD; all epochs the daily HR", () => {
    // 1000 ms all night (to 06:00), then 500 ms (120 /min) for the rest of the day.
    const night = steady(1000, 6 * MS.hour);
    const dayPart = steady(500, 18 * MS.hour).map((each) => ({
      ...each,
      endMs: each.endMs + 6 * MS.hour,
    }));
    const summary = dailySummary([...night, ...dayPart]);
    expect(summary.restingHeartRate).toBe(60);
    expect(summary.hrvRmssd).toBe(0);
    // The beat at exactly 06:00 ends the night's last interval but opens epoch 72.
    const epoch72 = 60_000 / ((1000 + 599 * 500) / 600);
    expect(summary.heartRate).toBe((72 * 60 + epoch72 + 215 * 120) / 288);
  });

  test("nothing at night gives nulls", () => {
    expect(dailySummary([iv(7 * MS.hour, 1000)])).toEqual({
      heartRate: null,
      restingHeartRate: null,
      hrvRmssd: null,
    });
  });
});

describe("dayFeatures and hourFeatures", () => {
  test("a steady day scores as regular at every level", () => {
    expect(dayFeatures(steady(1000, MS.day))).toEqual({
      "beat.flag_share": 0,
      "30s.irregular_share": 0,
      "30s.hr_jumps": 0,
      "5min.irregular_share": 0,
      "5min.hr_jumps": 0,
      "1h.irregular_share": 0,
      "1h.hr_jumps": 0,
      "unit.nrmssd": 0,
      "unit.heart_rate": 60,
      "day.resting_heart_rate": 60,
      "day.hrv_rmssd": 0,
    });
  });

  test("a steady hour", () => {
    expect(hourFeatures(steady(750, MS.hour))).toEqual({
      "beat.flag_share": 0,
      "30s.irregular_share": 0,
      "30s.hr_jumps": 0,
      "5min.irregular_share": 0,
      "5min.hr_jumps": 0,
      "unit.nrmssd": 0,
      "unit.heart_rate": 80,
    });
  });
});

describe("splitUnits", () => {
  test("re-times each unit from its own start", () => {
    const units = splitUnits([iv(500, 500), iv(1500, 1000, true), iv(2100, 600)], 1000);
    expect([...units.entries()]).toEqual([
      [0, [iv(500, 500)]],
      [1, [iv(500, 1000, true)]],
      [2, [iv(100, 600)]],
    ]);
  });
});
