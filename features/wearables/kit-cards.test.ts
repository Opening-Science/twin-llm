import { describe, expect, test } from "bun:test";

import { kitSections, type KitCard, type KitSection } from "./kit-cards";
import type { Metric } from "./metric-utils";
import type { WearableDetail } from "./wearable-detail";

/** One made-up reading a day ending 7 Nov 2026; `value` gets the day's index from the end. */
const series = (
  stem: string,
  days: number,
  value: (fromEnd: number) => number,
): Metric[] =>
  Array.from({ length: days }, (_, i) => {
    const date = new Date(Date.UTC(2026, 10, 7 - i)).toISOString().slice(0, 10);
    return { key: `${stem}.${date}`, label: stem, value: value(i), date };
  });

const TODAY = "2026-11-08";

const OURA: readonly Metric[] = [
  ...series("readiness.score", 40, (i) => (i === 0 ? 90 : 80)),
  ...series("sleep.score", 40, () => 75),
  ...series("activity.score", 40, () => 70),
  ...series("sleep.hr.long_sleep", 40, (i) => (i === 0 ? 60 : 56)),
  ...series("sleep.hrv.long_sleep", 40, () => 42),
  ...series("sleep.duration.long_sleep", 40, (i) => (i === 0 ? 400 : 450)),
  ...series("sleep.efficiency.long_sleep", 40, () => 90),
  ...series("activity.steps", 40, (i) => (i === 0 ? 12_000 : 8_000)),
];

const section = (sections: readonly KitSection[], id: KitSection["id"]) =>
  sections.find((s) => s.id === id)!;

const card = (cards: readonly KitCard[], id: string): KitCard =>
  cards.find((c) => c.id === id)!;

describe("kitSections, Oura", () => {
  const sections = kitSections({ source: "oura", metrics: OURA, today: TODAY });

  test("three sections in order, read from the latest day", () => {
    expect(sections.map((s) => `${s.title}: ${s.eyebrow}`)).toEqual([
      "Daily: 7 Nov 2026",
      "Weekly: 1 Nov to 7 Nov",
      "Monthly: November against October",
    ]);
  });

  test("the daily section has a ring per score, then sleep, steps, heart, HRV and the radar", () => {
    expect(section(sections, "daily").cards.map((c) => c.id)).toEqual([
      "ring:readiness.score.",
      "ring:sleep.score.",
      "ring:activity.score.",
      "nights:sleep.duration.",
      "daily:activity.steps.",
      "daily:sleep.hr.",
      "daily:sleep.hrv.",
      "radar:Night: Against usual",
    ]);
  });

  test("a score ring says the day against the usual and names the part", () => {
    const ring = card(section(sections, "daily").cards, "ring:readiness.score.");
    expect(ring).toMatchObject({
      sentence: "Your readiness score today is 90, above your usual.",
      state: "default",
      title: "7 Nov 2026",
      band: "Optimal",
      value: 90,
      readout: "7 Nov 2026 · 90 of 100",
    });
  });

  test("heart rate reads 3% as the edge of usual, and nights say last night", () => {
    const heart = card(section(sections, "daily").cards, "daily:sleep.hr.");
    expect(heart.sentence).toBe(
      "Your heart rate during sleep last night was 60 beats per minute, above your usual.",
    );
  });

  test("steps compare the last full day and keep their unit beside the number", () => {
    const steps = card(section(sections, "daily").cards, "daily:activity.steps.");
    expect(steps).toMatchObject({
      sentence: "You took 12,000 steps on your last full day, more than usual.",
      today: { label: "7 Nov 2026", value: "12,000", unit: "steps" },
      reference: { label: "Usual (7 days)", value: "8,000", unit: "steps" },
    });
  });

  test("today's unfinished step count is left out of the comparison", () => {
    const withToday = [
      ...OURA,
      { key: "activity.steps.2026-11-08", label: "s", value: 900, date: TODAY },
    ];
    const daily = section(
      kitSections({ source: "oura", metrics: withToday, today: TODAY }),
      "daily",
    );
    expect(card(daily.cards, "daily:activity.steps.")).toMatchObject({
      today: { label: "7 Nov 2026", value: "12,000" },
    });
  });

  test("sleep consistency has 14 nights with readouts, the usual as target", () => {
    const nights = card(section(sections, "daily").cards, "nights:sleep.duration.");
    if (nights.chart !== "consistency") throw new Error("not a consistency card");
    expect(nights.sentence).toBe("You slept 6 hr 40 min last night, less than usual.");
    expect(nights.values.length).toBe(14);
    expect(nights.target).toBe(450);
    expect(nights.readouts.at(-1)).toBe("Sat 7 Nov · 6 hr 40 min");
    // Hours in the number, minutes beside it: one line in a pair, read as "7 hr 30 min".
    expect(nights.reference).toEqual({
      label: "Usual (7 nights)",
      value: "7 hr",
      unit: "30 min",
    });
    expect(nights.last).toEqual({ label: "Last night", value: "6 hr", unit: "40 min" });
    expect(nights.axis).toEqual(["25 Oct", "7 Nov"]);
  });

  test("weekly bars run Monday to Sunday with readouts for days with a reading", () => {
    const steps = card(section(sections, "weekly").cards, "weekly:activity.steps.");
    if (steps.chart !== "weekly") throw new Error("not a weekly card");
    expect(steps.values).toEqual([8000, 8000, 8000, 8000, 8000, 12000, null]);
    expect(steps.readouts[0]).toBe("Mon 2 Nov · 8,000 steps");
    expect(steps.readouts[6]).toBeNull();
    expect(steps.sentence).toBe("You averaged 8,571 steps a day over the last 7 days.");
  });

  test("monthly compares November with October", () => {
    const hrv = card(section(sections, "monthly").cards, "month:sleep.hrv.");
    expect(hrv).toMatchObject({
      sentence: "Your heart rate variability this month is about the same as last month.",
      current: { month: "November", display: "42 ms" },
      previous: { month: "October", display: "42 ms" },
    });
  });

  test("the heart range has one bucket per week with a readout", () => {
    const range = card(section(sections, "monthly").cards, "weeks:sleep.hr.");
    if (range.chart !== "range") throw new Error("not a range card");
    // 29 Sept is a Tuesday: the weeks of 28 Sept to 2 Nov.
    expect(range.buckets.length).toBe(6);
    expect(range.buckets.at(-1)).toEqual({
      min: 56,
      max: 60,
      readout: "Week of 2 Nov · 56 to 60 bpm",
    });
  });

  test("the radar has a view per range, each with its own sentence", () => {
    const radar = card(section(sections, "daily").cards, "radar:Night: Against usual");
    if (radar.chart !== "radar") throw new Error("not a radar card");
    expect(radar.views.day?.sentence).toBe(
      "Your heart rate variability today is 42 milliseconds, about your usual.",
    );
    expect(radar.views.week?.axes.map((a) => a.label)).toEqual([
      "HRV",
      "During sleep",
      "Duration",
      "Efficiency",
    ]);
    expect(radar.views.day?.axes[1]?.readout).toBe(
      "Heart: During sleep · 60 bpm · usual 56 bpm",
    );
    expect(radar.views.month?.sentence).toBe(
      "Your heart rate variability this month is about the same as last month.",
    );
  });
});

describe("kitSections, thin data", () => {
  test("a reading with no history is an empty card that says when it fills", () => {
    const metrics = series("whoop.recovery.rhr", 2, () => 55);
    const daily = section(
      kitSections({ source: "whoop", metrics, today: TODAY }),
      "daily",
    );
    expect(daily.cards.map((c) => `${c.id} ${c.state}: ${c.sentence}`)).toEqual([
      "daily:whoop.recovery.rhr. empty: Your latest reading is compared with your usual one once 3 earlier days with a reading are in view.",
    ]);
  });

  test("a source with nothing in view gets one empty card per section", () => {
    const sections = kitSections({ source: "google-health", metrics: [], today: TODAY });
    expect(sections.map((s) => `${s.cards.length} ${s.cards[0]!.state}`)).toEqual([
      "1 empty",
      "1 empty",
      "1 empty",
    ]);
    expect(section(sections, "monthly").cards[0]!.sentence).toBe(
      "This month is compared with last month once the timeline reaches into both.",
    );
  });

  test("Whoop has no steps card and no score ring for strain", () => {
    const metrics = [
      ...series("whoop.recovery.score", 10, () => 60),
      ...series("whoop.cycle.strain", 10, () => 12),
    ];
    const daily = section(
      kitSections({ source: "whoop", metrics, today: TODAY }),
      "daily",
    );
    expect(daily.cards.map((c) => c.id)).toEqual(["ring:whoop.recovery.score."]);
  });
});

describe("band words", () => {
  test("describe the score and never advise", () => {
    const metrics = series("whoop.recovery.score", 10, (i) => (i === 0 ? 40 : 60));
    const daily = section(
      kitSections({ source: "whoop", metrics, today: TODAY }),
      "daily",
    );
    expect(daily.cards[0]).toMatchObject({ band: "Low" });
  });
});

/* --- detail cards ------------------------------------------------------------ */

const flatDay = (rate: number) =>
  Array.from({ length: 24 }, (_, h) => (h < 8 ? 0 : (h - 7) * rate));

/** 14 nights ending 7 Nov: bedtimes in minutes after 6 PM, asleep minutes. */
const NIGHTS = Array.from({ length: 14 }, (_, i) => {
  const day = new Date(Date.UTC(2026, 10, 7 - 13 + i)).toISOString().slice(0, 10);
  return { day, bedtime: i === 13 ? 360 : 300, asleep: i === 13 ? 400 : 450 };
});

const STEPS_OK = {
  status: "ok",
  day: TODAY,
  hourly: flatDay(500),
  usual: flatDay(400),
  usualDays: 14,
} as const;

const DETAIL: WearableDetail = {
  steps: STEPS_OK,
  night: {
    status: "ok",
    day: "2026-11-07",
    segments: [
      { stage: "core", start: 300, end: 330 },
      { stage: "deep", start: 330, end: 400 },
      { stage: "awake", start: 400, end: 405 },
    ],
  },
  nights: { status: "ok", nights: NIGHTS },
};

describe("kitSections, detail cards", () => {
  const sections = kitSections({
    source: "google-health",
    metrics: [],
    today: TODAY,
    detail: DETAIL,
    nowMinutes: 10 * 60 + 30,
  });
  const daily = section(sections, "daily").cards;

  test("stages and steps by the hour join the daily section; bedtimes the weekly one", () => {
    expect(daily.map((c) => c.id)).toEqual(["night:stages", "day:steps"]);
    expect(section(sections, "weekly").cards.map((c) => c.id)).toEqual([
      "nights:bedtime",
    ]);
  });

  test("today's steps stop at now and are compared by this time of day", () => {
    const steps = card(daily, "day:steps");
    if (steps.chart !== "cumulative") throw new Error("not a cumulative card");
    expect(steps.sentence).toBe(
      "You've taken more steps than usual by this time of day.",
    );
    expect(steps.now).toBe(630 / 1440);
    expect(steps.today.at(-1)).toEqual({
      at: 630 / 1440,
      value: 1_500,
      readout: "Now · 1,500 steps",
    });
    expect(steps.today.at(-2)?.readout).toBe("By 10:00 · 1,000 steps");
    expect(steps.average.length).toBe(25);
    expect(steps.axis).toEqual(["00:00", "12:00", "24:00"]);
  });

  test("a finished day is compared as a whole day", () => {
    const past = kitSections({
      source: "google-health",
      metrics: [],
      today: "2026-11-09",
      detail: DETAIL,
      nowMinutes: 600,
    });
    const steps = card(section(past, "daily").cards, "day:steps");
    if (steps.chart !== "cumulative") throw new Error("not a cumulative card");
    expect(steps.now).toBe(1);
    expect(steps.today.length).toBe(25);
    expect(steps.sentence).toBe(
      "You took 8,000 steps on your last full day, more than usual.",
    );
  });

  test("the hypnogram names each block and says last night's sleep against usual", () => {
    const night = card(daily, "night:stages");
    if (night.chart !== "hypnogram") throw new Error("not a hypnogram card");
    expect(night.sentence).toBe("You slept 6 hr 40 min last night, less than usual.");
    expect(night.label).toBe("Sleep: Stages, 7 Nov");
    expect(night.axis).toEqual(["23:00", "00:45"]);
    expect(night.spans.map((s) => s.readout)).toEqual([
      "Light · 23:00 to 23:30 · 30 min",
      "Deep · 23:30 to 00:40 · 1 hr 10 min",
      "Awake · 00:40 to 00:45 · 5 min",
    ]);
  });

  test("bedtimes across midnight read as clock times against the usual", () => {
    const bed = card(section(sections, "weekly").cards, "nights:bedtime");
    if (bed.chart !== "consistency") throw new Error("not a consistency card");
    expect(bed.sentence).toBe("Your bedtime was 60 minutes later than usual last night.");
    expect(bed.values.at(-1)).toBe(360);
    expect(bed.target).toBe(300);
    expect(bed.reference).toEqual({ label: "Usual (7 nights)", value: "23:00" });
    expect(bed.last).toEqual({ label: "Last night", value: "00:00" });
    expect(bed.readouts.at(-1)).toBe("Night of Fri 6 Nov · 00:00");
    expect(bed.axis).toEqual(["24 Oct", "6 Nov"]);
  });

  test("while the route answers, only cards the source can fill draw their loading shape", () => {
    const ids = (source: "oura" | "whoop" | "google-health") => {
      const loading = kitSections({
        source,
        metrics: [],
        today: TODAY,
        detail: "loading",
      });
      return [...section(loading, "daily").cards, ...section(loading, "weekly").cards]
        .filter((c) => c.state === "loading")
        .map((c) => c.id);
    };
    expect(ids("google-health")).toEqual(["night:stages", "day:steps", "nights:bedtime"]);
    expect(ids("oura")).toEqual(["night:stages", "nights:bedtime"]);
    expect(ids("whoop")).toEqual(["nights:bedtime"]);
  });

  test("Oura, which never sends steps by the hour, gets no steps-by-the-hour card", () => {
    const oura = kitSections({
      source: "oura",
      metrics: [],
      today: TODAY,
      detail: { ...DETAIL, steps: { status: "not-provided" } },
    });
    expect(section(oura, "daily").cards.map((c) => c.id)).toEqual(["night:stages"]);
  });

  test("WHOOP, which never sends stage segments, gets no stages card", () => {
    const whoop = kitSections({
      source: "whoop",
      metrics: [],
      today: TODAY,
      detail: {
        steps: { status: "not-provided" },
        night: { status: "totals-only" },
        nights: { status: "ok", nights: NIGHTS },
      },
    });
    expect(section(whoop, "daily").cards.map((c) => c.id)).toEqual(["empty:daily"]);
    expect(section(whoop, "weekly").cards.map((c) => c.id)).toEqual(["nights:bedtime"]);
  });

  test("Google Health with no hourly steps yet keeps the steps card, empty", () => {
    const none = kitSections({
      source: "google-health",
      metrics: [],
      today: TODAY,
      detail: { ...DETAIL, steps: { status: "missing" } },
    });
    expect(card(section(none, "daily").cards, "day:steps")).toMatchObject({
      state: "empty",
      sentence: "Your day by the hour appears here once a sync brings in hourly steps.",
    });
  });

  test("with no usual day yet, the steps card waits in its empty state", () => {
    const thin = kitSections({
      source: "google-health",
      metrics: [],
      today: TODAY,
      detail: { ...DETAIL, steps: { ...STEPS_OK, usual: null } },
    });
    expect(card(section(thin, "daily").cards, "day:steps")).toMatchObject({
      state: "empty",
      sentence:
        "Your day is compared with your usual day once 7 earlier days with hourly steps are in view.",
    });
  });
});
