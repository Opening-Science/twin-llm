import { describe, expect, test } from "bun:test";

import { kitSections, type KitCard, type KitSection } from "./kit-cards";
import type { Metric } from "./metric-utils";

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

  test("steps use the review wording and keep their unit beside the number", () => {
    const steps = card(section(sections, "daily").cards, "daily:activity.steps.");
    expect(steps).toMatchObject({
      sentence: "You've taken more steps than usual by this time of day.",
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
    expect(nights.readouts.at(-1)).toBe("Sat 7 Nov · 6 h 40 min");
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
