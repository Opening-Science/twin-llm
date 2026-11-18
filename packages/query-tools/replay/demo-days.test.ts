import { describe, expect, test } from "bun:test";

import {
  DEMO_DST_DAY,
  DEMO_PERSON_A,
  DEMO_PERSON_B,
  DEMO_REFERENCE_DAY,
  DEMO_TEN_DAYS,
  DEMO_TIME_ZONE,
  demoReplayDay,
  demoReplayDays,
} from "./demo-days";
import { isAvailable, type ReplayReading } from "./items";
import { localClock } from "./local-time";
import { DEMO_NOTICE, type ReplayDay, replayDaySchema } from "./replay-day";

const day = (subject: string, date: string): ReplayDay => {
  const found = demoReplayDay(subject, date);
  if (found === null) throw new Error(`no demo day ${subject} ${date}`);
  return found;
};

const clock = (reading: Readonly<{ at: string }>): string =>
  localClock(new Date(reading.at), DEMO_TIME_ZONE).time;

const stream = (
  one: ReplayDay,
  name: ReplayReading["stream"],
  specimen?: "blood" | "sensor",
): readonly ReplayReading[] =>
  one.readings.filter(
    (reading) =>
      reading.stream === name &&
      (specimen === undefined ||
        (reading.stream === "glucose" && reading.specimen === specimen)),
  );

const REFERENCE = day(DEMO_PERSON_A, DEMO_REFERENCE_DAY);

describe("the demo days", () => {
  test("every day of both people parses, is synthetic and carries the notice", () => {
    const all = [...demoReplayDays(DEMO_PERSON_A), ...demoReplayDays(DEMO_PERSON_B)];
    expect(all).toHaveLength(21 + 10 + 4);
    for (const one of all) {
      expect(replayDaySchema.safeParse(one).success).toBe(true);
      expect(one.origin).toBe("synthetic_demo");
      expect(one.notice).toBe(DEMO_NOTICE);
    }
  });

  test("the same call gives the same day", () => {
    expect(day(DEMO_PERSON_A, DEMO_REFERENCE_DAY)).toEqual(REFERENCE);
  });

  test("an unknown person or day is null, never a stand-in day", () => {
    expect(demoReplayDay("synthetic-replay-z", DEMO_REFERENCE_DAY)).toBeNull();
    expect(demoReplayDay(DEMO_PERSON_A, "2026-11-30")).toBeNull();
    expect(demoReplayDay(DEMO_PERSON_B, "2026-10-20")).toBeNull();
  });
});

describe("ten distinct nights", () => {
  test("ten consecutive dates, each with its own nightly values or none at all", () => {
    expect(DEMO_TEN_DAYS).toEqual([
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
    ]);
    const nights = DEMO_TEN_DAYS.map((date) => {
      const one = day(DEMO_PERSON_A, date);
      return [
        stream(one, "resting_heart_rate")[0]?.value,
        stream(one, "hrv_rmssd")[0]?.value,
      ];
    });
    expect(nights.filter(([resting]) => resting === undefined)).toHaveLength(1);
    const recorded = nights.filter(([resting]) => resting !== undefined).map(String);
    expect(new Set(recorded).size).toBe(9);
  });

  test("22 October has nothing recorded", () => {
    const empty = day(DEMO_PERSON_A, "2026-10-22");
    expect(empty.readings).toEqual([]);
    expect(empty.events).toEqual([]);
  });

  test("21 nights of history come before the ten days, nightly values only", () => {
    const history = demoReplayDays(DEMO_PERSON_A).filter(
      (one) => one.day < DEMO_TEN_DAYS[0]!,
    );
    expect(history).toHaveLength(21);
    expect(history[0]?.day).toBe("2026-09-29");
    for (const one of history) {
      expect(one.readings.map((reading) => reading.stream).sort()).toEqual([
        "hrv_rmssd",
        "resting_heart_rate",
      ]);
    }
  });

  test("person B has four days and no history before them", () => {
    expect(demoReplayDays(DEMO_PERSON_B).map((one) => one.day)).toEqual([
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
    ]);
  });
});

describe("the daylight-saving day", () => {
  const dst = day(DEMO_PERSON_A, DEMO_DST_DAY);

  test("25 hours of quarter-hour heart rate: 100 readings", () => {
    expect(stream(dst, "heart_rate")).toHaveLength(100);
    expect(stream(dst, "glucose", "sensor")).toHaveLength(100);
  });

  test("02:30 is read twice, once at +02:00 and once at +01:00", () => {
    const twoThirty = stream(dst, "heart_rate")
      .map((reading) => localClock(new Date(reading.at), DEMO_TIME_ZONE))
      .filter((local) => local.time === "02:30");
    expect(twoThirty.map((local) => local.offset)).toEqual(["+02:00", "+01:00"]);
  });

  test("an ordinary day has 96", () => {
    expect(stream(day(DEMO_PERSON_A, "2026-10-20"), "heart_rate")).toHaveLength(96);
  });
});

describe("the reference day holds the evidence for all sixteen phases", () => {
  test("sleep both ends, a walk, a run, four meals and winding down", () => {
    expect(
      REFERENCE.events.map((event) => [
        event.kind,
        event.activity ?? event.meal ?? event.label,
        event.provenance,
      ]),
    ).toEqual([
      ["sleep", "Sleep", "measured"],
      ["sleep", "Sleep", "measured"],
      ["activity", "walk", "measured"],
      ["activity", "run", "measured"],
      ["meal", "breakfast", "entered"],
      ["meal", "lunch", "entered"],
      ["meal", "snack", "entered"],
      ["meal", "dinner", "entered"],
      ["tag", "Winding down", "entered"],
    ]);
  });

  test("heart rate rises above 100 /min from 15:00 with almost no steps and no activity", () => {
    const window = (reading: ReplayReading): boolean =>
      clock(reading) >= "15:00" && clock(reading) < "15:45";
    expect(
      stream(REFERENCE, "heart_rate")
        .filter(window)
        .every((reading) => (reading.value ?? 0) > 100),
    ).toBe(true);
    expect(
      stream(REFERENCE, "steps")
        .filter(window)
        .every((reading) => (reading.value ?? 0) < 50),
    ).toBe(true);
  });

  test("heart rate every minute from 18:30 to 19:14, every 15 minutes elsewhere", () => {
    const fine = stream(REFERENCE, "heart_rate").filter(
      (reading) => reading.interval_min === 1,
    );
    expect(fine).toHaveLength(45);
    expect(clock(fine[0]!)).toBe("18:30");
    expect(clock(fine[fine.length - 1]!)).toBe("19:14");
    expect(stream(REFERENCE, "heart_rate")).toHaveLength(96 - 3 + 45);
  });

  test("sensor glucose rises before waking, after breakfast and after dinner", () => {
    const value = (time: string): number =>
      stream(REFERENCE, "glucose", "sensor").find((reading) => clock(reading) === time)
        ?.value ?? 0;
    expect(value("06:30")).toBeGreaterThan(value("04:00") + 8);
    expect(value("08:15")).toBeGreaterThan(value("07:30") + 30);
    expect(value("20:15")).toBeGreaterThan(140);
    expect(value("18:45")).toBeLessThan(value("18:00") - 10);
  });

  test("sensor glucose is missing from 10:00 to 10:45, with a reason and no value", () => {
    const missing = stream(REFERENCE, "glucose", "sensor").filter(
      (reading) => !isAvailable(reading),
    );
    expect(missing.map(clock)).toEqual(["10:00", "10:15", "10:30", "10:45"]);
    expect(missing.every((reading) => reading.value === null)).toBe(true);
    expect(
      missing.every((reading) => reading.missing_reason === "New sensor warming up"),
    ).toBe(true);
  });

  test("one blood glucose value, entered by the person, never mixed with the sensor", () => {
    const blood = stream(REFERENCE, "glucose", "blood");
    expect(
      blood.map((reading) => [clock(reading), reading.value, reading.provenance]),
    ).toEqual([["07:25", 98, "entered"]]);
  });
});

describe("missing, stale and partial days", () => {
  test("23 October: heart rate and steps stop at 20:00, glucose goes on", () => {
    const stale = day(DEMO_PERSON_A, "2026-10-23");
    expect(clock(stream(stale, "heart_rate").at(-1)!)).toBe("19:45");
    expect(clock(stream(stale, "steps").at(-1)!)).toBe("19:45");
    expect(clock(stream(stale, "glucose").at(-1)!)).toBe("23:45");
  });

  test("28 October: no glucose and no activity, heart rate and tags only", () => {
    const partial = day(DEMO_PERSON_A, "2026-10-28");
    expect(stream(partial, "glucose")).toEqual([]);
    expect(stream(partial, "steps")).toEqual([]);
    expect(partial.events.some((event) => event.kind === "activity")).toBe(false);
    expect(stream(partial, "heart_rate")).toHaveLength(96);
  });
});
