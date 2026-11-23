import { describe, expect, test } from "bun:test";

import { BASELINE_MIN_NIGHTS, personalBaseline } from "./baseline";
import {
  DEMO_PERSON_A,
  DEMO_PERSON_B,
  DEMO_REFERENCE_DAY,
  DEMO_TIME_ZONE,
  demoReplayDay,
  demoReplayDays,
} from "./demo-days";
import { localClock } from "./local-time";
import { recoveryAfter } from "./recovery";
import { type ReplayDay } from "./replay-day";

const day = (subject: string, date: string): ReplayDay => {
  const found = demoReplayDay(subject, date);
  if (found === null) throw new Error(`no demo day ${subject} ${date}`);
  return found;
};

const keyOf = (one: ReplayDay) => ({
  subject_ref: one.subject_ref,
  day: one.day,
  time_zone: one.time_zone,
  origin: one.origin,
});

const HISTORY_A = demoReplayDays(DEMO_PERSON_A);
const HISTORY_B = demoReplayDays(DEMO_PERSON_B);
const clock = (iso: string | null): string | null =>
  iso === null ? null : localClock(new Date(iso), DEMO_TIME_ZONE).time;

describe("personalBaseline", () => {
  test("with three weeks of nights before it, the 20th has a resting baseline", () => {
    const baseline = personalBaseline(
      HISTORY_A,
      keyOf(day(DEMO_PERSON_A, "2026-10-20")),
      "resting_heart_rate",
    );
    expect(baseline.state).toBe("available");
    if (baseline.state !== "available") return;
    expect(baseline.n).toBe(21);
    expect(baseline.median).toBe(54);
    expect(baseline.unit).toBe("/min");
    expect(baseline.from_day).toBe("2026-09-22");
    expect(baseline.to_day).toBe("2026-10-19");
    expect(baseline.evidence[0]).toBe("2026-09-29/night-resting-hr");
  });

  test("the day itself never counts towards its own baseline", () => {
    const baseline = personalBaseline(
      HISTORY_A,
      keyOf(day(DEMO_PERSON_A, "2026-10-27")),
      "resting_heart_rate",
    );
    expect(baseline.state === "available" && baseline.evidence).not.toContain(
      "2026-10-27/night-resting-hr",
    );
  });

  test("person B has too few nights: insufficient, with the counts, never a band", () => {
    const baseline = personalBaseline(
      HISTORY_B,
      keyOf(day(DEMO_PERSON_B, "2026-10-29")),
      "hrv_rmssd",
    );
    expect(baseline).toEqual({
      state: "insufficient",
      stream: "hrv_rmssd",
      n: 3,
      needed: BASELINE_MIN_NIGHTS,
      text: "3 of the 7 nights a personal baseline needs, in the 28 days before.",
    });
  });

  test("a missing night is left out, never counted as a value", () => {
    const ringOff = HISTORY_B.map((one) =>
      one.day === "2026-10-28"
        ? {
            ...one,
            readings: one.readings.map((reading) =>
              reading.stream === "resting_heart_rate"
                ? {
                    ...reading,
                    availability: "missing" as const,
                    value: null,
                    missing_reason: "Ring off the finger" as const,
                  }
                : reading,
            ),
          }
        : one,
    );
    const baseline = personalBaseline(
      ringOff,
      keyOf(day(DEMO_PERSON_B, "2026-10-29")),
      "resting_heart_rate",
    );
    expect(baseline).toEqual({
      state: "insufficient",
      stream: "resting_heart_rate",
      n: 2,
      needed: BASELINE_MIN_NIGHTS,
      text: "2 of the 7 nights a personal baseline needs, in the 28 days before.",
    });
  });

  test("another person's nights never fill a baseline", () => {
    const baseline = personalBaseline(
      [...HISTORY_A, ...HISTORY_B],
      keyOf(day(DEMO_PERSON_B, "2026-10-29")),
      "resting_heart_rate",
    );
    expect(baseline.state).toBe("insufficient");
  });

  test("demo nights never feed a recorded day's baseline", () => {
    const baseline = personalBaseline(
      HISTORY_A,
      { ...keyOf(day(DEMO_PERSON_A, "2026-10-20")), origin: "recorded" },
      "resting_heart_rate",
    );
    expect(baseline.state).toBe("insufficient");
  });
});

describe("recoveryAfter", () => {
  const reference = day(DEMO_PERSON_A, DEMO_REFERENCE_DAY);
  const run = reference.events.find((event) => event.activity === "run");

  test("with minute readings around the run's end, the one-minute drop is read", () => {
    if (run === undefined) throw new Error("no run");
    const recovery = recoveryAfter(reference, run);
    expect(recovery.one_minute.state).toBe("available");
    const drop = recovery.one_minute;
    if (drop.state !== "available") return;
    expect(drop.drop_per_min).toBe(drop.from_per_min - drop.to_per_min);
    const first = reference.readings.find((reading) => reading.id === drop.evidence[0]);
    expect(clock(first?.at ?? null)).toBe("18:45");
    expect(drop.drop_per_min).toBeGreaterThan(10);
    expect(recovery.resolution_min).toBe(1);
    expect(recovery.thresholds).toBe("placeholder");
  });

  test("back within 10 /min of the rate before the run, to the minute", () => {
    if (run === undefined) throw new Error("no run");
    const recovery = recoveryAfter(reference, run);
    expect(recovery.before_per_min).not.toBeNull();
    const back = reference.readings.find((reading) => reading.at === recovery.back_at);
    expect(back?.value).toBeLessThanOrEqual((recovery.before_per_min ?? 0) + 10);
    expect(recovery.back_within_min).toBeGreaterThan(15);
    expect(recovery.back_within_min).toBeLessThan(30);
  });

  test("from 15-minute readings there is no one-minute drop, and the result says why", () => {
    const coarse = day(DEMO_PERSON_A, "2026-10-21");
    const coarseRun = coarse.events.find((event) => event.activity === "run");
    if (coarseRun === undefined) throw new Error("no run");
    const recovery = recoveryAfter(coarse, coarseRun);
    expect(recovery.one_minute).toEqual({
      state: "insufficient_sampling",
      spacing_min: 15,
      text: "Heart rate here is 15 minutes apart, too coarse for a one-minute recovery.",
    });
    expect(recovery.resolution_min).toBe(15);
    expect((recovery.back_within_min ?? 0) % 15).toBe(0);
  });
});
