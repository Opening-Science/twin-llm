import { describe, expect, test } from "bun:test";

import {
  DEMO_DST_DAY,
  DEMO_PERSON_A,
  DEMO_PERSON_B,
  DEMO_REFERENCE_DAY,
  demoPerson,
  demoReplayDay,
} from "./demo-days";
import { type ReplayReading } from "./items";
import { localInstant } from "./local-time";
import { type ReplayDay } from "./replay-day";
import {
  estimatedMaxHeartRate,
  HEART_RATE_ZONES,
  NO_AGE_TEXT,
  type PersonRecord,
  zoneMinutes,
  zoneOf,
} from "./zones";

const day = (subject: string, date: string): ReplayDay => {
  const found = demoReplayDay(subject, date);
  if (found === null) throw new Error(`no demo day ${subject} ${date}`);
  return found;
};

const personA = (): PersonRecord => {
  const found = demoPerson(DEMO_PERSON_A);
  if (found === null) throw new Error("no demo person A");
  return found;
};

const at = (date: string, time: string): number =>
  localInstant(date, time, "Europe/Berlin").getTime();

const isHeartRate = (reading: ReplayReading): boolean => reading.stream === "heart_rate";

const totalOf = (result: ReturnType<typeof zoneMinutes>): number =>
  result.state === "available"
    ? Object.values(result.minutes).reduce((sum, value) => sum + value, 0) +
      result.no_zone_min
    : Number.NaN;

describe("the maximum heart rate estimate", () => {
  test("is Tanaka's 208 − 0.7 × age", () => {
    expect(estimatedMaxHeartRate(40)).toBe(180);
    expect(estimatedMaxHeartRate(34)).toBeCloseTo(184.2, 6);
  });
});

describe("the zone bands", () => {
  test("four zones, in order, each starting where the one before ends", () => {
    expect(HEART_RATE_ZONES.map((zone) => zone.id)).toEqual([
      "light",
      "moderate",
      "intense",
      "very_intense",
    ]);
    HEART_RATE_ZONES.slice(1).forEach((zone, index) =>
      expect(zone.from_pct).toBe(HEART_RATE_ZONES[index]?.to_pct ?? Number.NaN),
    );
    expect(HEART_RATE_ZONES.at(-1)?.to_pct).toBeNull();
  });

  test("a share of the maximum falls in one band; below light is no zone", () => {
    expect(zoneOf(56.9)).toBeNull();
    expect(zoneOf(57)).toBe("light");
    expect(zoneOf(63.9)).toBe("light");
    expect(zoneOf(64)).toBe("moderate");
    expect(zoneOf(76.9)).toBe("moderate");
    expect(zoneOf(77)).toBe("intense");
    expect(zoneOf(95.9)).toBe("intense");
    expect(zoneOf(96)).toBe("very_intense");
    expect(zoneOf(120)).toBe("very_intense");
  });
});

describe("zoneMinutes", () => {
  test("without an age it says so, and guesses nothing", () => {
    const person = demoPerson(DEMO_PERSON_B);
    expect(person).not.toBeNull();
    expect(person?.age_years).toBeNull();
    if (person === null) return;
    const result = zoneMinutes(day(DEMO_PERSON_B, "2026-10-27"), person);
    expect(result).toEqual({ state: "unavailable", reason: "no_age", text: NO_AGE_TEXT });
    expect(NO_AGE_TEXT).toBe("unavailable: no age");
  });

  test("another person's record is refused, not used", () => {
    const result = zoneMinutes(day(DEMO_PERSON_B, "2026-10-27"), personA());
    expect(result.state).toBe("unavailable");
    expect(result.state === "unavailable" && result.reason).toBe("other_person");
  });

  test("a day with no heart rate has no zone minutes, not zeros", () => {
    const result = zoneMinutes(day(DEMO_PERSON_A, "2026-10-22"), personA());
    expect(result.state).toBe("unavailable");
    expect(result.state === "unavailable" && result.reason).toBe("no_heart_rate");
  });

  test("on the reference day the run lands in intense", () => {
    const result = zoneMinutes(day(DEMO_PERSON_A, DEMO_REFERENCE_DAY), personA());
    expect(result.state).toBe("available");
    if (result.state !== "available") return;
    expect(result.provenance).toBe("derived");
    expect(result.rule.id).toBe("heart_rate_zone_minutes");
    expect(result.estimated_max_heart_rate_per_min).toBeCloseTo(184.2, 6);
    // The 45-minute run, and the first minutes after it before heart rate falls.
    expect(result.minutes.intense + result.minutes.very_intense).toBeGreaterThanOrEqual(
      45,
    );
    expect(result.minutes.very_intense).toBe(0);
    expect(result.evidence).toContain(`person:${DEMO_PERSON_A}/age_years`);
    expect(
      result.evidence.some((ref) => ref.startsWith(`${DEMO_REFERENCE_DAY}/hr-`)),
    ).toBe(true);
  });

  test("15-minute and one-minute samples together count each minute once", () => {
    const result = zoneMinutes(day(DEMO_PERSON_A, DEMO_REFERENCE_DAY), personA());
    expect(result.state === "available" && result.heart_rate_min).toBe(1440);
    expect(totalOf(result)).toBe(1440);
  });

  test("the 25-hour day counts 25 hours", () => {
    expect(totalOf(zoneMinutes(day(DEMO_PERSON_A, DEMO_DST_DAY), personA()))).toBe(1500);
  });

  test("after the ring stops syncing, the rest of the day is no zone at all", () => {
    const result = zoneMinutes(day(DEMO_PERSON_A, "2026-10-23"), personA());
    expect(result.state === "available" && result.heart_rate_min).toBe(20 * 60);
    expect(totalOf(result)).toBe(20 * 60);
  });

  test("missing readings in the run are a gap, not any zone", () => {
    const reference = day(DEMO_PERSON_A, DEMO_REFERENCE_DAY);
    const runFrom = at(DEMO_REFERENCE_DAY, "18:00");
    const runTo = at(DEMO_REFERENCE_DAY, "18:30");
    const gapped: ReplayDay = {
      ...reference,
      readings: reference.readings.map((reading) =>
        isHeartRate(reading) &&
        Date.parse(reading.at) >= runFrom &&
        Date.parse(reading.at) < runTo
          ? {
              ...reading,
              availability: "missing",
              value: null,
              missing_reason: "Ring off the finger",
            }
          : reading,
      ),
    };
    const whole = zoneMinutes(reference, personA());
    const result = zoneMinutes(gapped, personA());
    expect(result.state === "available" && result.heart_rate_min).toBe(1440 - 30);
    expect(totalOf(result)).toBe(1440 - 30);
    if (whole.state !== "available" || result.state !== "available") return;
    expect(result.minutes.intense + result.minutes.very_intense).toBe(
      whole.minutes.intense + whole.minutes.very_intense - 30,
    );
  });

  test("a reading counts only until the next one, never past it", () => {
    const reference = day(DEMO_PERSON_A, DEMO_REFERENCE_DAY);
    const first = reference.readings.find(isHeartRate);
    if (first === undefined) throw new Error("no heart rate");
    const fiveLater = {
      ...first,
      id: "hr-five-later",
      at: new Date(Date.parse(first.at) + 5 * 60_000).toISOString(),
    };
    const crowded: ReplayDay = {
      ...reference,
      readings: [...reference.readings, fiveLater],
    };
    expect(totalOf(zoneMinutes(crowded, personA()))).toBe(1440);
  });
});
