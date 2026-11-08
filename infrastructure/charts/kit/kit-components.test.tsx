import { describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ComparisonPair,
  Consistency,
  CumulativeDay,
  Hypnogram,
  InsightCard,
  LabResultCard,
  MonthComparison,
  Radar,
  RangeBars,
  ResearchFigure,
  ScoreRing,
  StreakGrid,
  WeeklyBars,
  hoursMinutes,
  radar,
  radarHeight,
  type ChartState,
} from ".";

const STATES: readonly ChartState[] = ["default", "loading", "empty"];
const html = (node: ReactElement): string => renderToStaticMarkup(node);

/** Every kit chart, in a given state, with synthetic data. */
const charts = (state: ChartState) => ({
  comparison: (
    <ComparisonPair
      category="steps"
      state={state}
      today={{ label: "Today", value: "6,204", unit: "steps" }}
      reference={{ label: "Average", value: "7,950", unit: "steps" }}
    />
  ),
  day: (
    <CumulativeDay
      category="steps"
      state={state}
      today={[
        { at: 0, value: 0 },
        { at: 0.5, value: 4100 },
      ]}
      average={[
        { at: 0, value: 0 },
        { at: 1, value: 8000 },
      ]}
      now={0.5}
    />
  ),
  weekly: (
    <WeeklyBars
      category="activity"
      state={state}
      values={[6, 8, 7, null, 9, 5, 7]}
      average={7}
      caption="Average steps"
      hero="7,120"
    />
  ),
  streak: (
    <StreakGrid
      category="activity"
      state={state}
      days={[
        { date: "2026-11-01", done: true },
        { date: "2026-11-02", done: false },
      ]}
      today="2026-11-02"
    />
  ),
  range: (
    <RangeBars
      category="heart"
      state={state}
      buckets={[
        { min: 58, max: 92 },
        { min: 61, max: 114 },
        { min: 55, max: 80 },
      ]}
      axis={["6 AM", "Now"]}
    />
  ),
  hypnogram: (
    <Hypnogram
      category="sleep"
      state={state}
      spans={[
        { stage: "core", start: 0, end: 95 },
        { stage: "deep", start: 95, end: 150 },
      ]}
    />
  ),
  ring: (
    <ScoreRing
      category="sleep"
      state={state}
      title="Sleep score"
      band="High"
      parts={[
        { label: "Duration", value: 45, max: 50 },
        { label: "Bedtime", value: 25, max: 30 },
        { label: "Interruptions", value: 15, max: 20 },
      ]}
    />
  ),
  month: (
    <MonthComparison
      category="sleep"
      state={state}
      current={{ month: "November", value: 439, display: "7 hr 19 min" }}
      previous={{ month: "October", value: 402, display: "6 hr 42 min" }}
    />
  ),
  consistency: (
    <Consistency
      category="sleep"
      state={state}
      values={[30, 40, 20, 50]}
      target={30}
      reference={{ label: "Average bedtime", value: "11:12 PM" }}
      last={{ label: "Last night", value: "11:48 PM" }}
    />
  ),
  radar: (
    <Radar
      category="sleep"
      state={state}
      axes={[
        { label: "REM", value: 96, display: "1 hr 36 min", reference: 88, max: 150 },
        { label: "Deep", value: 70, display: "1 hr 10 min", max: 120 },
        { label: "Core", value: null, display: "4 hr 8 min", max: 330 },
      ]}
    />
  ),
  estimates: (
    <ResearchFigure
      kind="estimates"
      category="vitals"
      state={state}
      estimates={[{ label: "Within person", estimate: 3.09, low: 2.07, high: 4.63 }]}
      reference={{ value: 1, label: "Shuffled" }}
    />
  ),
  pairs: (
    <ResearchFigure
      kind="pairs"
      category="heart"
      state={state}
      groups={[
        {
          label: "AFDB",
          estimates: [
            { label: "Sensitivity", estimate: 0.954 },
            { label: "Specificity", estimate: 0.796 },
          ],
        },
      ]}
    />
  ),
  null: (
    <ResearchFigure
      kind="null"
      category="vitals"
      state={state}
      draws={[0.48, 0.5, 0.51, 0.52, 0.49]}
      observed={0.61}
      observedLabel="AUC"
    />
  ),
});

describe.each([...STATES])("every chart in the %s state", (state) => {
  test.each(Object.entries(charts(state)))(
    "%s renders and marks its state",
    (_, node) => {
      const out = html(node);
      expect(out.length).toBeGreaterThan(0);
      expect(out).toContain(`data-state="${state}"`);
    },
  );

  test.each(Object.entries(charts(state)))(
    "%s draws are hidden from screen readers",
    (_, node) => {
      const out = html(node);
      const svgs = out.match(/<svg[^>]*>/g) ?? [];
      expect(svgs.every((tag) => tag.includes('aria-hidden="true"'))).toBe(true);
    },
  );
});

describe("insight card", () => {
  const card = (state: ChartState) =>
    html(
      <InsightCard
        category="sleep"
        state={state}
        label="Sleep: Stages"
        sentence="You slept 7 hr 19 min, 37 minutes more than your 7-night average."
        emptyNote="7 nights needed"
      >
        <span>chart</span>
      </InsightCard>,
    );

  test("the sentence is the readable text and the body is hidden under it", () => {
    const out = card("default");
    expect(out).toContain("You slept 7 hr 19 min");
    expect(out).toContain("Sleep: Stages");
    expect(out).toMatch(/<div aria-hidden="true"><span>chart<\/span><\/div>/);
    expect(out).not.toContain("7 nights needed");
  });

  test("loading says so and shows shapes instead of the sentence", () => {
    const out = card("loading");
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain('role="status"');
    expect(out).not.toContain("You slept");
  });

  test("empty keeps the sentence and adds what is needed", () => {
    const out = card("empty");
    expect(out).toContain("You slept");
    expect(out).toContain("7 nights needed");
  });
});

describe("words, not tooltips", () => {
  test("range bars write MIN and MAX with their values", () => {
    const out = html(charts("default").range);
    expect(out).toContain("MAX 114");
    expect(out).toContain("MIN 55");
    expect(html(charts("empty").range)).not.toContain("MAX");
  });

  test("every hypnogram lane carries its word and its total", () => {
    const out = html(charts("default").hypnogram);
    for (const word of ["Awake", "REM", "Core", "Deep"]) expect(out).toContain(word);
    expect(out).toContain("1 hr 35 min");
    expect(out).toContain("55 min");
    expect(html(charts("empty").hypnogram)).toContain("Deep");
  });

  test("the ring shows its score and each part as value/max", () => {
    const out = html(charts("default").ring);
    expect(out).toContain(">85<");
    expect(out).toContain("Duration: 45/50");
    expect(out).toContain("High");
  });

  test("the null figure labels the observed value", () => {
    expect(html(charts("default").null)).toContain("AUC 0.61");
  });

  test("pairs name the dataset and the measure on each row", () => {
    const out = html(charts("default").pairs);
    expect(out).toContain("AFDB · Sensitivity");
    expect(out).toContain("AFDB · Specificity");
  });

  test("heroes show today and the reference; empty hides today's value", () => {
    expect(html(charts("default").comparison)).toContain("6,204");
    const empty = html(charts("empty").comparison);
    expect(empty).not.toContain("6,204");
    expect(empty).toContain("7,950");
  });
});

test("radar vertices carry their word and value; a missing value is a dash", () => {
  const out = html(charts("default").radar);
  expect(out).toContain("REM");
  expect(out).toContain("1 hr 36 min");
  expect(out).not.toContain("4 hr 8 min");
  expect(out).toContain("–");
  const empty = html(charts("empty").radar);
  expect(empty).toContain("Deep");
  expect(empty).not.toContain("1 hr 36 min");
});

test("the radar grows by about a third in a wide card and keeps its phone size", () => {
  const axes = [1, 2, 3].map((v) => ({
    label: String(v),
    value: v,
    display: "",
    max: 3,
  }));
  const size = (width: number) =>
    radar(axes, { width, height: radarHeight(width) }, { x: 80, y: 40 }).radius;
  expect(size(318)).toBe(79);
  expect(size(560) / size(318)).toBeGreaterThan(1.25);
  expect(size(560) / size(318)).toBeLessThan(1.45);
});

describe("lab result card", () => {
  test("the outcome is a word", () => {
    const out = html(
      <LabResultCard
        category="vitals"
        title="Audit chain"
        outcome={{ word: "Intact", tone: "pass" }}
        sentence="All 1,204 audit rows link to the one before."
        rows={[{ label: "Rows", value: "1,204" }]}
      />,
    );
    expect(out).toContain("Intact");
    expect(out).toContain("1,204");
  });

  test("loading hides the numbers and the outcome", () => {
    const out = html(
      <LabResultCard
        category="vitals"
        state="loading"
        title="Audit chain"
        outcome={{ word: "Intact", tone: "pass" }}
        sentence="x"
        rows={[{ label: "Rows", value: "1,204" }]}
      />,
    );
    expect(out).not.toContain("Intact");
    expect(out).not.toContain("1,204");
    expect(out).toContain('aria-busy="true"');
  });
});

test("durations read as hours and minutes", () => {
  expect(hoursMinutes(439)).toBe("7 hr 19 min");
  expect(hoursMinutes(45)).toBe("45 min");
  expect(hoursMinutes(-3)).toBe("0 min");
});
