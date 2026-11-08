import { describe, expect, test } from "bun:test";

import { formatDuration, INSIGHT_METRIC_BY_STEM, insight } from "./insight";

describe("T1 today against usual", () => {
  test("steps below, about and above", () => {
    expect(insight("steps", { template: "today", today: 3_000, usual: 5_000 })).toBe(
      "You've taken fewer steps than usual by this time of day.",
    );
    expect(insight("steps", { template: "today", today: 5_100, usual: 5_000 })).toBe(
      "You're taking about as many steps as you usually do by now.",
    );
    expect(insight("steps", { template: "today", today: 7_000, usual: 5_000 })).toBe(
      "You've taken more steps than usual by this time of day.",
    );
  });

  test("the tolerance band includes its edges", () => {
    const at = (today: number) =>
      insight("restingHeartRate", {
        template: "today",
        today,
        usual: 100,
        tolerance: 0.05,
      });
    expect(at(105)).toBe(
      "Your resting heart rate today is 105 beats per minute, about your usual.",
    );
    expect(at(95)).toBe(
      "Your resting heart rate today is 95 beats per minute, about your usual.",
    );
    expect(at(105.01)).toBe(
      "Your resting heart rate today is 105 beats per minute, above your usual.",
    );
    expect(at(94.99)).toBe(
      "Your resting heart rate today is 95 beats per minute, below your usual.",
    );
  });

  test("the default band is 5% of usual", () => {
    expect(insight("hrv", { template: "today", today: 42, usual: 40 })).toBe(
      "Your heart rate variability today is 42 milliseconds, about your usual.",
    );
    expect(insight("hrv", { template: "today", today: 43, usual: 40 })).toBe(
      "Your heart rate variability today is 43 milliseconds, above your usual.",
    );
  });

  test("a zero tolerance leaves only an exact match as usual", () => {
    expect(
      insight("readiness", { template: "today", today: 81, usual: 80, tolerance: 0 }),
    ).toBe("Your readiness score today is 81, above your usual.");
    expect(
      insight("readiness", { template: "today", today: 80, usual: 80, tolerance: 0 }),
    ).toBe("Your readiness score today is 80, about your usual.");
  });

  test("sleep states the night first", () => {
    expect(insight("sleepDuration", { template: "today", today: 370, usual: 440 })).toBe(
      "You slept 6 hr 10 min last night, less than usual.",
    );
    expect(insight("sleepDuration", { template: "today", today: 444, usual: 440 })).toBe(
      "You slept 7 hr 24 min last night, about your usual.",
    );
    expect(insight("sleepDuration", { template: "today", today: 510, usual: 440 })).toBe(
      "You slept 8 hr 30 min last night, more than usual.",
    );
  });

  test("recovery uses its own noun", () => {
    expect(insight("recovery", { template: "today", today: 40, usual: 66 })).toBe(
      "Your recovery score today is 40, below your usual.",
    );
  });
});

describe("T2 weekly average", () => {
  test("count", () => {
    expect(insight("steps", { template: "weekly", average: 7_860.4 })).toBe(
      "You averaged 7,860 steps a day over the last 7 days.",
    );
  });

  test("duration", () => {
    expect(insight("sleepDuration", { template: "weekly", average: 444 })).toBe(
      "You slept for an average of 7 hr 24 min a night in the last 7 days.",
    );
  });

  test("rate with the unit spelled out", () => {
    expect(insight("restingHeartRate", { template: "weekly", average: 54.4 })).toBe(
      "Your resting heart rate averaged 54 beats per minute over the last 7 days.",
    );
    expect(insight("heartRate", { template: "weekly", average: 71 })).toBe(
      "Your heart rate averaged 71 beats per minute over the last 7 days.",
    );
    expect(insight("hrv", { template: "weekly", average: 42.6 })).toBe(
      "Your heart rate variability averaged 43 milliseconds over the last 7 days.",
    );
  });

  test("a score has no unit", () => {
    expect(insight("readiness", { template: "weekly", average: 78 })).toBe(
      "Your readiness score averaged 78 over the last 7 days.",
    );
  });

  test("one of a unit is singular", () => {
    expect(insight("steps", { template: "weekly", average: 1 })).toBe(
      "You averaged 1 step a day over the last 7 days.",
    );
  });
});

describe("T3 monthly comparison", () => {
  test("more and less", () => {
    expect(
      insight("sleepDuration", { template: "monthly", thisMonth: 450, lastMonth: 410 }),
    ).toBe("On average, you're sleeping more this month than last month.");
    expect(
      insight("sleepDuration", { template: "monthly", thisMonth: 380, lastMonth: 430 }),
    ).toBe("On average, you're sleeping less this month than last month.");
    expect(
      insight("steps", { template: "monthly", thisMonth: 9_000, lastMonth: 7_000 }),
    ).toBe("On average, you're taking more steps this month than last month.");
    expect(
      insight("steps", { template: "monthly", thisMonth: 6_000, lastMonth: 7_000 }),
    ).toBe("On average, you're taking fewer steps this month than last month.");
  });

  test("inside the band reads as the same", () => {
    expect(
      insight("steps", { template: "monthly", thisMonth: 7_350, lastMonth: 7_000 }),
    ).toBe("Your daily step count this month is about the same as last month.");
    expect(
      insight("steps", { template: "monthly", thisMonth: 7_351, lastMonth: 7_000 }),
    ).toBe("On average, you're taking more steps this month than last month.");
    expect(
      insight("sleepDuration", { template: "monthly", thisMonth: 430, lastMonth: 420 }),
    ).toBe("Your nightly sleep this month is about the same as last month.");
  });

  test("delta lower and higher", () => {
    expect(
      insight("restingHeartRate", { template: "monthly", thisMonth: 54, lastMonth: 56 }),
    ).toBe(
      "Your resting heart rate this month is 2 beats per minute lower than last month.",
    );
    expect(insight("hrv", { template: "monthly", thisMonth: 47, lastMonth: 42 })).toBe(
      "Your heart rate variability this month is 5 milliseconds higher than last month.",
    );
    expect(
      insight("recovery", { template: "monthly", thisMonth: 61, lastMonth: 60 }),
    ).toBe("Your recovery score this month is 1 point higher than last month.");
    expect(
      insight("heartRate", { template: "monthly", thisMonth: 70.6, lastMonth: 70 }),
    ).toBe("Your heart rate this month is 1 beat per minute higher than last month.");
  });

  test("a delta that rounds to nothing is the same", () => {
    expect(
      insight("restingHeartRate", {
        template: "monthly",
        thisMonth: 54.3,
        lastMonth: 54,
      }),
    ).toBe("Your resting heart rate this month is about the same as last month.");
  });
});

describe("T4 streak count", () => {
  test("days over a step threshold", () => {
    expect(
      insight("steps", { template: "streak", per: "days", threshold: 10_000, count: 16 }),
    ).toBe(
      "In the last 4 weeks, you've taken 10,000 steps or more on 16 different days.",
    );
    expect(
      insight("steps", { template: "streak", per: "days", threshold: 10_000, count: 1 }),
    ).toBe("In the last 4 weeks, you've taken 10,000 steps or more on 1 day.");
    expect(
      insight("steps", { template: "streak", per: "days", threshold: 10_000, count: 0 }),
    ).toBe("In the last 4 weeks, you've taken 10,000 steps or more on no days.");
  });

  test("nights over a sleep threshold", () => {
    expect(
      insight("sleepDuration", {
        template: "streak",
        per: "nights",
        threshold: 420,
        count: 19,
        total: 28,
      }),
    ).toBe("You slept 7 hours or more on 19 of the last 28 nights.");
    expect(
      insight("sleepDuration", {
        template: "streak",
        per: "nights",
        threshold: 450,
        count: 3,
        total: 7,
      }),
    ).toBe("You slept 7 hr 30 min or more on 3 of the last 7 nights.");
    expect(
      insight("sleepDuration", {
        template: "streak",
        per: "nights",
        threshold: 60,
        count: 7,
        total: 7,
      }),
    ).toBe("You slept 1 hour or more on 7 of the last 7 nights.");
  });
});

describe("T5 range", () => {
  test("during a session", () => {
    expect(
      insight("heartRate", {
        template: "range",
        context: { during: "session", session: "walk" },
        min: 86,
        max: 121,
      }),
    ).toBe("During your last walk, your heart rate was 86 to 121 beats per minute.");
  });

  test("while asleep", () => {
    expect(
      insight("heartRate", { template: "range", context: "sleep", min: 48.4, max: 61.6 }),
    ).toBe(
      "Your heart rate ranged from 48 to 62 beats per minute while you were asleep.",
    );
    expect(
      insight("hrv", { template: "range", context: "sleep", min: 28, max: 61 }),
    ).toBe(
      "Your heart rate variability ranged from 28 to 61 milliseconds while you were asleep.",
    );
  });

  test("puts the lower value first", () => {
    expect(
      insight("heartRate", { template: "range", context: "sleep", min: 62, max: 48 }),
    ).toBe(
      "Your heart rate ranged from 48 to 62 beats per minute while you were asleep.",
    );
  });
});

describe("T6 target hit or miss", () => {
  const night = (actual: number, usual: number, windowMinutes = 30) =>
    insight("bedtime", { template: "target", actual, usual, windowMinutes });

  test("later and earlier than usual", () => {
    expect(night(23 * 60 + 41, 23 * 60)).toBe(
      "Your bedtime was 41 minutes later than usual last night.",
    );
    expect(night(22 * 60, 23 * 60)).toBe(
      "Your bedtime was 60 minutes earlier than usual last night.",
    );
  });

  test("within the window, edge included", () => {
    expect(night(23 * 60 + 30, 23 * 60)).toBe(
      "You went to bed within 30 minutes of your usual time.",
    );
    expect(night(23 * 60 + 31, 23 * 60)).toBe(
      "Your bedtime was 31 minutes later than usual last night.",
    );
  });

  test("counts the short way across midnight", () => {
    expect(night(40, 23 * 60 + 50)).toBe(
      "Your bedtime was 50 minutes later than usual last night.",
    );
    expect(night(23 * 60, 20)).toBe(
      "Your bedtime was 80 minutes earlier than usual last night.",
    );
  });

  test("one minute is singular", () => {
    expect(night(23 * 60 + 1, 23 * 60, 0)).toBe(
      "Your bedtime was 1 minute later than usual last night.",
    );
  });
});

describe("missing values", () => {
  test("give null, never a sentence about 0", () => {
    expect(insight("steps", { template: "today", today: null, usual: 5_000 })).toBeNull();
    expect(
      insight("steps", { template: "today", today: 5_000, usual: undefined }),
    ).toBeNull();
    expect(insight("hrv", { template: "weekly", average: Number.NaN })).toBeNull();
    expect(
      insight("restingHeartRate", {
        template: "monthly",
        thisMonth: 54,
        lastMonth: null,
      }),
    ).toBeNull();
    expect(
      insight("steps", {
        template: "streak",
        per: "days",
        threshold: 10_000,
        count: null,
      }),
    ).toBeNull();
    expect(
      insight("heartRate", { template: "range", context: "sleep", min: null, max: 60 }),
    ).toBeNull();
    expect(
      insight("bedtime", {
        template: "target",
        actual: null,
        usual: 1380,
        windowMinutes: 30,
      }),
    ).toBeNull();
  });

  test("a real 0 is still a value", () => {
    expect(insight("steps", { template: "weekly", average: 0 })).toBe(
      "You averaged 0 steps a day over the last 7 days.",
    );
  });
});

describe("locale", () => {
  test("defaults to en-GB grouping", () => {
    expect(insight("steps", { template: "weekly", average: 12_345 })).toBe(
      "You averaged 12,345 steps a day over the last 7 days.",
    );
  });

  test("follows the locale it is given", () => {
    expect(insight("steps", { template: "weekly", average: 12_345 }, "de-DE")).toBe(
      "You averaged 12.345 steps a day over the last 7 days.",
    );
    expect(
      insight(
        "steps",
        { template: "streak", per: "days", threshold: 100_000, count: 12 },
        "en-IN",
      ),
    ).toBe(
      "In the last 4 weeks, you've taken 1,00,000 steps or more on 12 different days.",
    );
  });

  test("durations read as hours and minutes", () => {
    expect(formatDuration(444)).toBe("7 hr 24 min");
    expect(formatDuration(420)).toBe("7 hr");
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(59.6)).toBe("1 hr");
  });
});

describe("every sentence", () => {
  const sentences = [
    insight("steps", { template: "today", today: 3_000, usual: 5_000 }),
    insight("sleepDuration", { template: "weekly", average: 444 }),
    insight("restingHeartRate", { template: "monthly", thisMonth: 54, lastMonth: 56 }),
    insight("steps", { template: "streak", per: "days", threshold: 10_000, count: 16 }),
    insight("heartRate", { template: "range", context: "sleep", min: 48, max: 62 }),
    insight("bedtime", {
      template: "target",
      actual: 1421,
      usual: 1380,
      windowMinutes: 30,
    }),
  ];

  test("is one sentence with a full stop and no exclamation mark", () => {
    for (const sentence of sentences) {
      expect(sentence?.endsWith(".")).toBe(true);
      expect(sentence?.includes("!")).toBe(false);
      expect(sentence?.slice(0, -1).includes(". ")).toBe(false);
    }
  });
});

describe("templates a metric does not take", () => {
  test("do not compile, and give null if forced", () => {
    // @ts-expect-error heart rate has no usual for this time of day
    expect(insight("heartRate", { template: "today", today: 70, usual: 70 })).toBeNull();
    expect(
      // @ts-expect-error a step count has no range
      insight("steps", { template: "range", context: "sleep", min: 1, max: 2 }),
    ).toBeNull();
  });
});

describe("INSIGHT_METRIC_BY_STEM", () => {
  test("maps stored stems from each source", () => {
    expect(INSIGHT_METRIC_BY_STEM["activity.steps"]).toBe("steps");
    expect(INSIGHT_METRIC_BY_STEM["google.steps"]).toBe("steps");
    expect(INSIGHT_METRIC_BY_STEM["whoop.recovery.rhr"]).toBe("restingHeartRate");
    expect(INSIGHT_METRIC_BY_STEM["readiness.score"]).toBe("readiness");
    expect(INSIGHT_METRIC_BY_STEM["whoop.recovery.score"]).toBe("recovery");
  });
});

describe("scores and nightly measures (#520)", () => {
  test("a night's measure says last night", () => {
    expect(insight("sleepScore", { template: "today", today: 82, usual: 80 })).toBe(
      "Your sleep score last night was 82, about your usual.",
    );
    expect(
      insight("sleepingHeartRate", { template: "today", today: 61, usual: 56 }),
    ).toBe(
      "Your heart rate during sleep last night was 61 beats per minute, above your usual.",
    );
    expect(insight("sleepPerformance", { template: "today", today: 70, usual: 84 })).toBe(
      "Your sleep performance last night was 70 percent, below your usual.",
    );
    expect(insight("timeInBed", { template: "today", today: 480, usual: 470 })).toBe(
      "Your time in bed last night was 8 hr, about your usual.",
    );
  });

  test("a day's score says today", () => {
    expect(insight("activityScore", { template: "today", today: 90, usual: 78 })).toBe(
      "Your activity score today is 90, above your usual.",
    );
  });

  test("monthly changes carry their own unit", () => {
    expect(
      insight("sleepScore", { template: "monthly", thisMonth: 81, lastMonth: 77 }),
    ).toBe("Your sleep score this month is 4 points higher than last month.");
    expect(
      insight("sleepPerformance", { template: "monthly", thisMonth: 80, lastMonth: 83 }),
    ).toBe(
      "Your sleep performance this month is 3 percentage points lower than last month.",
    );
    expect(
      insight("timeInBed", { template: "monthly", thisMonth: 470, lastMonth: 495 }),
    ).toBe("Your time in bed this month is 25 min shorter than last month.");
  });

  test("a tighter tolerance moves a resting heart rate out of about", () => {
    const data = { template: "today", today: 58, usual: 56 } as const;
    expect(insight("restingHeartRate", data)).toBe(
      "Your resting heart rate today is 58 beats per minute, about your usual.",
    );
    expect(insight("restingHeartRate", { ...data, tolerance: 0.03 })).toBe(
      "Your resting heart rate today is 58 beats per minute, above your usual.",
    );
  });

  test("their stems map", () => {
    expect(INSIGHT_METRIC_BY_STEM["sleep.score"]).toBe("sleepScore");
    expect(INSIGHT_METRIC_BY_STEM["sleep.hr"]).toBe("sleepingHeartRate");
    expect(INSIGHT_METRIC_BY_STEM["whoop.sleep.in_bed_min"]).toBe("timeInBed");
  });
});
