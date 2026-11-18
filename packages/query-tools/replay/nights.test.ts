import { describe, expect, test } from "bun:test";

import {
  DEMO_PERSON_A,
  DEMO_PERSON_B,
  DEMO_TEN_DAYS,
  DEMO_TIME_ZONE,
  demoReplayDays,
} from "./demo-days";
import { localClock } from "./local-time";
import { type NightSummary, nightSummaries } from "./nights";
import { replayDaySchema } from "./replay-day";

const A = {
  subject_ref: DEMO_PERSON_A,
  time_zone: DEMO_TIME_ZONE,
  origin: "synthetic_demo",
} as const;
const B = { ...A, subject_ref: DEMO_PERSON_B };

const HISTORY = [...demoReplayDays(DEMO_PERSON_A), ...demoReplayDays(DEMO_PERSON_B)];
const NIGHTS = nightSummaries(HISTORY, A, DEMO_TEN_DAYS);

const on = (date: string): NightSummary => {
  const found = NIGHTS.find((night) => night.day === date);
  if (found === undefined) throw new Error(`no night ${date}`);
  return found;
};

const value = (field: Readonly<{ state: string }>): number | null =>
  field.state === "available" && "value" in field && typeof field.value === "number"
    ? field.value
    : null;

describe("ten nights of person A", () => {
  test("one summary per date, in order, each about that person and date", () => {
    expect(NIGHTS.map((night) => night.day)).toEqual([...DEMO_TEN_DAYS]);
    expect(NIGHTS.every((night) => night.subject_ref === DEMO_PERSON_A)).toBe(true);
    expect(NIGHTS.every((night) => night.time_zone === DEMO_TIME_ZONE)).toBe(true);
  });

  test("resting heart rate and HRV are the device's own values, labelled measured", () => {
    const night = on("2026-10-24");
    expect(night.resting_heart_rate).toMatchObject({
      state: "available",
      value: 61,
      unit: "/min",
      provenance: "measured",
      source: "Synthetic ring (demo)",
    });
    expect(night.hrv).toMatchObject({ value: 48, unit: "ms", provenance: "measured" });
  });

  test("the deltas follow the personal baseline of 54 /min", () => {
    expect(NIGHTS.map((night) => value(night.resting_delta))).toEqual([
      0,
      1,
      null,
      -1,
      7,
      2,
      6,
      8,
      3,
      0,
    ]);
    expect(on("2026-10-27").resting_delta).toMatchObject({ provenance: "derived" });
  });

  test("one raised night alone is notable; the second in a row is worth a look", () => {
    expect(NIGHTS.map((night) => night.status.status)).toEqual([
      "usual",
      "usual",
      "insufficient_data",
      "usual",
      "notable",
      "usual",
      "notable",
      "worth_a_look",
      "usual",
      "usual",
    ]);
    expect(on("2026-10-27").status.rule.id).toBe("resting_heart_rate_elevated_nights");
    expect(on("2026-10-27").status.reason).toBe(
      "+8 /min against the baseline, the second night or more in a row.",
    );
    expect(on("2026-10-27").status.evidence).toContain("2026-10-26/night-resting-hr");
  });

  test("every evidence id names its day, the night's own reading included", () => {
    for (const night of NIGHTS) {
      const delta = night.resting_delta;
      const ids = [
        ...night.status.evidence,
        ...(delta.state === "available" ? delta.evidence : []),
      ];
      for (const id of ids) expect(id).toMatch(/^\d{4}-\d{2}-\d{2}\/[^/]+$/);
    }
    expect(on("2026-10-27").status.evidence).toContain("2026-10-27/night-resting-hr");
    expect(on("2026-10-27").status.evidence).not.toContain("night-resting-hr");
  });

  test("the sentence says what the numbers show, without a cause", () => {
    expect(on("2026-10-27").sentence).toBe(
      "Resting heart rate 62 /min, 8 /min above the personal baseline of 54 /min. The second raised night or more in a row.",
    );
    expect(on("2026-10-20").sentence).toBe(
      "Resting heart rate 54 /min, level with the personal baseline of 54 /min.",
    );
  });

  test("reference bands come from the baseline and say how", () => {
    const band = on("2026-10-20").bands.resting_heart_rate;
    expect(band.state).not.toBe("unavailable");
    if (band.state === "unavailable") return;
    expect(band.low).toBeLessThan(54);
    expect(band.high).toBeGreaterThan(54);
    expect(band.rule).toContain("MAD");
  });

  test("the selected day's metrics: steps, activity minutes, peak and the night's low", () => {
    const night = on("2026-10-27");
    expect(night.availability).toBe("complete");
    expect(night.steps).toMatchObject({ provenance: "derived", complete: true });
    expect(night.activity_minutes).toMatchObject({ walk: 45, run: 45 });
    expect(value(night.peak_heart_rate)).toBeGreaterThan(160);
    const low = night.lowest_night_heart_rate;
    expect(low.state).toBe("available");
    if (low.state !== "available" || low.at === null) return;
    expect(localClock(new Date(low.at), DEMO_TIME_ZONE).time < "06:30").toBe(true);
    expect(night.night?.to).toBe("2026-10-27T05:30:00.000Z");
  });

  test("the 25-hour day counts its coverage over 100 quarter-hours", () => {
    expect(on("2026-10-25").coverage).toEqual({ heart_rate: 1, glucose: 1, steps: 1 });
  });
});

describe("missing and partial days", () => {
  test("22 October: selectable, says nothing was recorded, shows no value", () => {
    const night = on("2026-10-22");
    expect(night.availability).toBe("none");
    expect(night.availability_text).toBe("Nothing was recorded on this day.");
    expect(night.sentence).toBe("No resting heart rate recorded this night.");
    for (const field of [
      night.resting_heart_rate,
      night.hrv,
      night.resting_delta,
      night.steps,
      night.activity_minutes,
      night.peak_heart_rate,
      night.lowest_night_heart_rate,
    ]) {
      expect(field.state).toBe("unavailable");
    }
    expect(night.sources).toEqual([]);
  });

  test("23 October: heart rate covers part of the day, and the summary says so", () => {
    const night = on("2026-10-23");
    expect(night.availability).toBe("partial");
    expect(night.availability_text).toBe(
      "Partial: heart rate covers 83% of the day; steps covers 83% of the day.",
    );
    expect(night.steps).toMatchObject({ complete: false });
  });

  test("28 October: no glucose and no steps, said in words; no activity minutes invented", () => {
    const night = on("2026-10-28");
    expect(night.availability_text).toBe(
      "Partial: no steps recorded; no glucose recorded.",
    );
    expect(night.coverage.glucose).toBeNull();
    expect(night.activity_minutes).toEqual({
      state: "unavailable",
      text: "No activity recorded on this day.",
    });
  });

  test("a date the history does not hold is nothing recorded, never a neighbour's values", () => {
    const [night] = nightSummaries(HISTORY, A, ["2026-11-05"]);
    expect(night?.availability).toBe("none");
    expect(night?.resting_heart_rate.state).toBe("unavailable");
  });
});

describe("baselines need history; people stay apart", () => {
  const nightsB = nightSummaries(HISTORY, B, [
    "2026-10-26",
    "2026-10-27",
    "2026-10-28",
    "2026-10-29",
  ]);

  test("person B: no baseline, no band, no delta, never usual", () => {
    for (const night of nightsB) {
      expect(night.status.status).toBe("insufficient_data");
      expect(night.bands.resting_heart_rate.state).toBe("unavailable");
      expect(night.resting_delta.state).toBe("unavailable");
      expect(night.sentence).toContain("Not enough nights yet for a personal baseline.");
    }
  });

  test("person A's summaries are the same with or without person B's days", () => {
    expect(nightSummaries(demoReplayDays(DEMO_PERSON_A), A, DEMO_TEN_DAYS)).toEqual(
      NIGHTS,
    );
  });

  test("on the same dates the two people's values differ: nothing crosses over", () => {
    const a27 = on("2026-10-27");
    const b27 = nightsB[1];
    expect(b27?.subject_ref).toBe(DEMO_PERSON_B);
    expect(value(b27?.resting_heart_rate ?? { state: "unavailable" })).toBe(59);
    expect(value(a27.resting_heart_rate)).toBe(62);
  });

  test("on recorded data the elevated-night rule does not classify yet", () => {
    // Person A's days as if recorded: real values and a baseline, so the rule
    // would classify the raised night if it were approved for recordings.
    const recordedHistory = demoReplayDays(DEMO_PERSON_A).map((one) =>
      replayDaySchema.parse(
        JSON.parse(
          JSON.stringify({ ...one, notice: null }).replaceAll(
            '"origin":"synthetic_demo"',
            '"origin":"recorded"',
          ),
        ),
      ),
    );
    const [night] = nightSummaries(recordedHistory, { ...A, origin: "recorded" }, [
      "2026-10-27",
    ]);
    expect(night?.availability).toBe("complete");
    expect(value(night?.resting_heart_rate ?? { state: "unavailable" })).toBe(62);
    expect(night?.baselines.resting_heart_rate.state).toBe("available");
    expect(night?.status.status).toBe("not_classified");
    expect(night?.status.reason).toContain("not approved for recorded data");
  });
});
