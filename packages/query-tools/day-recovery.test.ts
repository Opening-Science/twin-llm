import { describe, expect, test } from "bun:test";

import { DAY_THRESHOLDS, type DayReading } from "./day-beats";
import { recoveries } from "./day-recovery";
import { mockDayReadings } from "./mock-day";

/** The illustrative mock day: hand-written values, not a recording of anyone. */
const MOCK: readonly DayReading[] = mockDayReadings("blood");

const heart = (
  time: string,
  heartRatePerMin: number | null,
  moving: boolean | null,
): DayReading => ({ time, event: null, heartRatePerMin, glucoseMgDl: null, moving });

describe("recoveries on the mock day", () => {
  test("three workouts, each back within 10 /min of the still rate before it", () => {
    // Hand-checked: walk 08:15 (64 before, 66 at 10:00), walk 13:00 (68 before, 68 at
    // 15:30), run 18:00–18:45 (68 before, 72 at 19:30).
    expect(
      recoveries(MOCK).map((one) => [
        one.from,
        one.to,
        one.event,
        one.peak_per_min,
        one.baseline_per_min,
        one.back_at,
        one.back_within_min,
      ]),
    ).toEqual([
      ["08:15", "08:15", "Walk, glucose peak", 95, 64, "10:00", 105],
      ["13:00", "13:00", "Walk after lunch", 100, 68, "15:30", 150],
      ["18:00", "18:45", "Run", 160, 68, "19:30", 45],
    ]);
    expect(recoveries(MOCK).every((one) => one.band_per_min === 10)).toBe(true);
    expect(recoveries(MOCK).every((one) => one.thresholds === "placeholder")).toBe(true);
  });
});

describe("recoveries", () => {
  test("a still reading above the band does not count; the next one inside does", () => {
    const [one] = recoveries([
      heart("17:00", 60, false),
      heart("17:30", 150, true),
      heart("17:40", 90, false),
      heart("17:55", 70, false),
    ]);
    expect(one?.back_at).toBe("17:55");
    expect(one?.back_within_min).toBe(25);
  });

  test("not back by the end of the day: no time", () => {
    const [one] = recoveries([
      heart("21:00", 60, false),
      heart("21:30", 150, true),
      heart("22:00", 95, false),
    ]);
    expect(one?.back_at).toBeNull();
    expect(one?.back_within_min).toBeNull();
  });

  test("not back before the next workout: the later recovery is the next one's", () => {
    const [walk, run] = recoveries([
      heart("07:00", 60, false),
      heart("07:30", 110, true),
      heart("08:00", 120, false),
      heart("08:30", 160, true),
      heart("09:00", 65, false),
    ]);
    expect(walk?.back_at).toBeNull();
    expect(walk?.back_within_min).toBeNull();
    expect(run?.back_at).toBe("09:00");
  });

  test("no still reading before: no baseline, so no recovery time", () => {
    const [one] = recoveries([heart("06:00", 140, true), heart("06:30", 60, false)]);
    expect(one?.baseline_per_min).toBeNull();
    expect(one?.back_within_min).toBeNull();
  });

  test("unknown activity is never a workout and never still", () => {
    expect(recoveries([heart("10:00", 150, null), heart("10:30", 60, null)])).toEqual([]);
    const [one] = recoveries([
      heart("10:00", 60, false),
      heart("10:30", 150, true),
      heart("11:00", 60, null),
      heart("11:30", 62, false),
    ]);
    expect(one?.back_at).toBe("11:30");
  });

  test("the band comes from the thresholds", () => {
    const [one] = recoveries(
      [heart("17:00", 60, false), heart("17:30", 150, true), heart("17:40", 75, false)],
      { ...DAY_THRESHOLDS, recoveryWithinPerMin: 15 },
    );
    expect(one?.back_at).toBe("17:40");
  });
});
