import { describe, expect, test } from "bun:test";

import {
  type CheckedReading,
  checkCitedValues,
  labelAliases,
  parseStatedNumber,
} from "./cited-value-check";

const score: CheckedReading = {
  key: "sleep.score.2026-01-02",
  label: "Sleep score (2026-01-02)",
  value: 82,
};
const hrv: CheckedReading = {
  key: "sleep.hrv.long_sleep.2026-01-02",
  label: "Average HRV during sleep (2026-01-02)",
  value: 45.3,
  unit: "ms",
};
const duration: CheckedReading = {
  key: "sleep.duration.long_sleep.2026-01-02",
  label: "Total sleep duration (2026-01-02)",
  value: 452,
  unit: "min",
};
const spo2: CheckedReading = {
  key: "whoop.recovery.spo2.2026-01-02",
  label: "Whoop SpO2 (2026-01-02)",
  value: 96.4,
  unit: "%",
};
const steps: CheckedReading = {
  key: "activity.steps.2026-01-02",
  label: "Steps (2026-01-02)",
  value: 8432,
};
const rhr: CheckedReading = {
  key: "whoop.recovery.rhr.2026-01-02",
  label: "Whoop resting HR (2026-01-02)",
  value: 52,
  unit: "bpm",
};
const distance: CheckedReading = {
  key: "workout.distance.running.2026-01-02",
  label: "Workout distance, running (2026-01-02)",
  value: 5230,
  unit: "m",
};

const one = (text: string, reading: CheckedReading) =>
  checkCitedValues(text, [reading])[0];

describe("parseStatedNumber", () => {
  test("thousands separators, decimal points and decimal commas", () => {
    expect(parseStatedNumber("8,432")).toEqual({ value: 8432, decimals: 0 });
    expect(parseStatedNumber("1'234.5")).toEqual({ value: 1234.5, decimals: 1 });
    expect(parseStatedNumber("45,3")).toEqual({ value: 45.3, decimals: 1 });
    expect(parseStatedNumber("7,25")).toEqual({ value: 7.25, decimals: 2 });
    expect(parseStatedNumber("45,300")).toEqual({ value: 45300, decimals: 0 });
  });
});

describe("labelAliases", () => {
  test("drops the day, the vendor and qualifiers; HR may be heart rate", () => {
    expect(labelAliases(hrv.label)).toContain("hrv");
    expect(labelAliases(rhr.label)).toEqual([
      "whoop resting hr",
      "whoop resting heart rate",
      "resting hr",
      "resting heart rate",
    ]);
    expect(labelAliases("Sleep HRV (2026-01-02)")).toEqual(["sleep hrv", "hrv"]);
    expect(labelAliases("Whoop HRV RMSSD (2026-01-02)")).toEqual([
      "whoop hrv rmssd",
      "hrv rmssd",
      "hrv",
      "rmssd",
    ]);
    expect(labelAliases(duration.label)).toContain("sleep duration");
    expect(labelAliases(duration.label)).toContain("total sleep");
    expect(labelAliases(distance.label)).toEqual(["workout distance"]);
  });

  test("never a single broad word", () => {
    expect(labelAliases(duration.label)).not.toContain("sleep");
    expect(labelAliases(score.label)).toEqual(["sleep score"]);
  });
});

describe("checkCitedValues: same number", () => {
  test("a label then its value matches", () => {
    expect(one("Your sleep score was 82 last night.", score)).toEqual({
      status: "matched",
      stated: "82",
    });
  });

  test("another value is not matched, and names what the answer said", () => {
    expect(one("Your sleep score was 75 last night.", score)).toEqual({
      status: "not_matched",
      stated: "75",
    });
  });

  test("a reading the answer cites but states no number for is unstated", () => {
    expect(one("Your sleep score was in its usual range.", score)).toEqual({
      status: "unstated",
    });
    expect(one("", score)).toEqual({ status: "unstated" });
  });

  test("a key on an Evidence Used line, with or without its label", () => {
    expect(one("- [sleep.score.2026-01-02] 82", score)?.status).toBe("matched");
    expect(one("- [sleep.score.2026-01-02] Sleep score: 82", score)?.status).toBe(
      "matched",
    );
    expect(one("- [sleep.score.2026-01-02] Sleep score: 79", score)).toEqual({
      status: "not_matched",
      stated: "79",
    });
  });

  test("the number written just before the label", () => {
    expect(one("You walked 8,432 steps.", steps)).toEqual({
      status: "matched",
      stated: "8,432",
    });
    expect(one("You walked 8,000 steps.", steps)?.status).toBe("not_matched");
    expect(one("A 45 ms HRV is in your usual range.", hrv)?.status).toBe("matched");
  });

  test("score spellings: points, /100, out of 100", () => {
    expect(one("Sleep score: 82/100.", score)?.status).toBe("matched");
    expect(one("Sleep score of 82 out of 100.", score)?.status).toBe("matched");
    expect(one("Sleep score of 82 points.", score)?.status).toBe("matched");
  });
});

describe("checkCitedValues: rounding", () => {
  test("rounds to the decimals the app shows: 45 ms stands for 45.3", () => {
    expect(one("HRV averaged 45 ms.", hrv)?.status).toBe("matched");
    expect(one("HRV averaged 45.3 ms.", hrv)?.status).toBe("matched");
    expect(one("HRV averaged 46 ms.", hrv)?.status).toBe("not_matched");
    expect(one("HRV averaged 45.4 ms.", hrv)?.status).toBe("not_matched");
  });

  test("a value shown with one decimal must keep it: 96% is not 96.4", () => {
    expect(one("SpO2 was 96.4%.", spo2)?.status).toBe("matched");
    expect(one("SpO2 was 96%.", spo2)?.status).toBe("not_matched");
  });

  test("more decimals than stored still match within the stored precision", () => {
    expect(one("Sleep score 82.0 overall.", score)?.status).toBe("matched");
    expect(one("Sleep score 82.6 overall.", score)?.status).toBe("not_matched");
  });

  test("a decimal comma reads as a decimal", () => {
    expect(one("HRV averaged 45,3 ms.", hrv)?.status).toBe("matched");
    expect(one("HRV averaged 44,8 ms.", hrv)?.status).toBe("not_matched");
  });
});

describe("checkCitedValues: units and durations", () => {
  test("unit spellings of the same dimension", () => {
    expect(one("HRV was 45 milliseconds.", hrv)?.status).toBe("matched");
    expect(one("Resting heart rate was 52 beats per minute.", rhr)?.status).toBe(
      "matched",
    );
    expect(one("Resting HR 52/min.", rhr)?.status).toBe("matched");
    expect(one("SpO2 was 96.4 percent.", spo2)?.status).toBe("matched");
  });

  test("a number with a unit of another dimension is not this reading's", () => {
    expect(one("HRV changed over 3 nights and was 45 ms.", hrv)?.status).toBe("matched");
    expect(one("Sleep score 82% of the time.", score)).toEqual({ status: "unstated" });
  });

  test("durations as minutes, hours, hours and minutes, or h:mm", () => {
    expect(one("Total sleep was 452 min.", duration)?.status).toBe("matched");
    expect(one("Total sleep was 7 h 32 min.", duration)).toEqual({
      status: "matched",
      stated: "7 h 32 min",
    });
    expect(one("Total sleep was 7 hours and 32 minutes.", duration)?.status).toBe(
      "matched",
    );
    expect(one("Total sleep was 7h32m.", duration)?.status).toBe("matched");
    expect(one("Total sleep was 7:32.", duration)?.status).toBe("matched");
    expect(one("Total sleep was 7.5 hours.", duration)?.status).toBe("matched");
    expect(one("Total sleep was 7,5 h.", duration)?.status).toBe("matched");
    expect(one("Total sleep was 27,120 seconds.", duration)?.status).toBe("matched");
  });

  test("a duration at a coarser precision than it can bear is not matched", () => {
    expect(one("Total sleep was 7 hours.", duration)).toEqual({
      status: "not_matched",
      stated: "7 hours",
    });
    expect(one("Total sleep was 7 h 10 min.", duration)?.status).toBe("not_matched");
  });

  test("m is metres for a reading in metres, and km converts", () => {
    expect(one("Workout distance was 5.23 km.", distance)?.status).toBe("matched");
    expect(one("Workout distance was 5230 m.", distance)?.status).toBe("matched");
    expect(one("Workout distance was 5.2 km.", distance)?.status).toBe("matched");
    expect(one("Workout distance was 6 km.", distance)?.status).toBe("not_matched");
  });
});

describe("checkCitedValues: what is never a stated value", () => {
  test("dates and keys", () => {
    expect(one("Sleep score on 2026-01-02: 82.", score)?.status).toBe("matched");
    expect(one("Sleep score on 2 Jan 2026 was 82.", score)?.status).toBe("matched");
    expect(one("Sleep score on 2 Jan was 82.", score)?.status).toBe("matched");
    expect(one("Sleep score [sleep.score.2026-01-02].", score)).toEqual({
      status: "unstated",
    });
  });

  test("a difference is not a reading", () => {
    expect(one("HRV was 7 ms below your usual range.", hrv)).toEqual({
      status: "unstated",
    });
    expect(one("Sleep score dropped by 5 this week.", score)).toEqual({
      status: "unstated",
    });
  });

  test("a small whole number counts only for a small reading", () => {
    expect(one("Sleep score: 3 nights in a row it stayed high.", score)).toEqual({
      status: "unstated",
    });
    const strain: CheckedReading = {
      key: "whoop.cycle.strain.2026-01-02",
      label: "Whoop day strain (2026-01-02)",
      value: 8.4,
    };
    expect(one("Strain was 8.4.", strain)?.status).toBe("matched");
  });

  test("a reading that is not a number is not checked", () => {
    const summary: CheckedReading = {
      key: "stress.day_summary.2026-01-02",
      label: "Stress day summary (2026-01-02)",
      value: "restored",
    };
    expect(checkCitedValues("Stress day summary 3.", [summary])).toEqual([null]);
  });
});

describe("checkCitedValues: several readings", () => {
  const day2: CheckedReading = {
    key: "sleep.score.2026-01-03",
    label: "Sleep score (2026-01-03)",
    value: 79,
  };

  test("a label stands for every day it was cited for", () => {
    expect(
      checkCitedValues("Sleep score was 82 and then sleep score was 79.", [score, day2]),
    ).toEqual([
      { status: "matched", stated: "82" },
      { status: "matched", stated: "79" },
    ]);
  });

  test("a number matching a sibling day is not a mismatch for the other", () => {
    expect(checkCitedValues("Sleep score was 82.", [score, day2])).toEqual([
      { status: "matched", stated: "82" },
      { status: "unstated" },
    ]);
  });

  test("a key names its own day: another day's value is not matched", () => {
    expect(
      checkCitedValues(
        "- [sleep.score.2026-01-02] Sleep score: 79\n- [sleep.score.2026-01-03] Sleep score: 79",
        [score, day2],
      ),
    ).toEqual([
      { status: "not_matched", stated: "79" },
      { status: "matched", stated: "79" },
    ]);
  });

  test("each reading takes the number after its own mention", () => {
    expect(
      checkCitedValues("HRV 45 ms, resting heart rate 58 bpm and sleep score 82.", [
        hrv,
        rhr,
        score,
      ]),
    ).toEqual([
      { status: "matched", stated: "45 ms" },
      { status: "not_matched", stated: "58 bpm" },
      { status: "matched", stated: "82" },
    ]);
  });

  test("a whole reply: every section is read, the thinking is not passed", () => {
    const reply = [
      "## Reasoning",
      "Total sleep was 7 h 32 min and HRV averaged 41 ms.",
      "## Evidence Used",
      "- [sleep.duration.long_sleep.2026-01-02]",
      "- [sleep.hrv.long_sleep.2026-01-02]",
      "## Answer",
      "Sleep was close to your usual length.",
    ].join("\n");
    expect(checkCitedValues(reply, [duration, hrv])).toEqual([
      { status: "matched", stated: "7 h 32 min" },
      { status: "not_matched", stated: "41 ms" },
    ]);
  });
});
