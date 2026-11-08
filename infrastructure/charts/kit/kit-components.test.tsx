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
  dimmed,
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

describe("interactive charts", () => {
  const weekly = (readouts?: readonly (string | null)[], defaultFocus?: number) =>
    html(
      <WeeklyBars
        category="steps"
        values={[6, 8, 7]}
        average={7}
        caption="Average steps"
        hero="7"
        readouts={readouts}
        label="Steps: Weekly"
        defaultFocus={defaultFocus}
      />,
    );

  test("without readouts a chart stays a picture: no tab stop, no readout", () => {
    const out = weekly();
    expect(out).not.toContain('role="group"');
    expect(out).not.toContain("aria-live");
    expect(out).not.toContain("tabindex");
  });

  test("with readouts it is one named tab stop with a live readout", () => {
    const out = weekly(["Mon · 6", "Tue · 8", "Wed · 7"]);
    expect(out.match(/role="group"/g)).toHaveLength(1);
    expect(out).toContain('tabindex="0"');
    expect(out).toContain('aria-label="Steps: Weekly"');
    expect(out).toContain('aria-live="polite"');
    expect(out).not.toContain("Tue · 8");
  });

  test("a focused point is named and the rest step back", () => {
    const out = weekly(["Mon · 6", "Tue · 8", "Wed · 7"], 1);
    expect(out).toContain("Tue · 8");
    expect(out.match(/fill-opacity="0.4"/g)?.length).toBeGreaterThanOrEqual(2);
  });

  test("a focus outside the data is ignored", () => {
    expect(weekly(["Mon · 6", "Tue · 8", "Wed · 7"], 9)).not.toContain("fill-opacity");
  });

  test("loading and empty charts are never interactive", () => {
    const out = html(
      <WeeklyBars
        category="steps"
        state="loading"
        values={[6, 8, 7]}
        average={7}
        caption="Average steps"
        hero="7"
        readouts={["a", "b", "c"]}
      />,
    );
    expect(out).not.toContain('role="group"');
  });

  test.each([
    [
      "C05",
      <CumulativeDay
        key="c05"
        category="steps"
        today={[
          { at: 0, value: 0, readout: "12 AM · 0 steps" },
          { at: 0.5, value: 4100, readout: "12 PM · 4,100 steps" },
        ]}
        average={[
          { at: 0, value: 0 },
          { at: 1, value: 8000 },
        ]}
        now={0.5}
        defaultFocus={1}
      />,
      "12 PM · 4,100 steps",
    ],
    [
      "C08",
      <RangeBars
        key="c08"
        category="heart"
        buckets={[
          { min: 58, max: 92, readout: "8 AM · 58 to 92 bpm" },
          { min: 61, max: 114, readout: "9 AM · 61 to 114 bpm" },
        ]}
        defaultFocus={0}
      />,
      "8 AM · 58 to 92 bpm",
    ],
    [
      "C13",
      <Consistency
        key="c13"
        category="sleep"
        values={[30, 40]}
        readouts={["2 Nov · 11:30 PM", "3 Nov · 11:40 PM"]}
        target={30}
        reference={{ label: "Average bedtime", value: "11:12 PM" }}
        last={{ label: "Last night", value: "11:40 PM" }}
        defaultFocus={1}
      />,
      "3 Nov · 11:40 PM",
    ],
    [
      "R1",
      <ResearchFigure
        key="r1"
        kind="estimates"
        category="vitals"
        estimates={[
          {
            label: "A",
            estimate: 2,
            low: 1,
            high: 3,
            readout: "A · 2.00 (1.00 to 3.00)",
          },
          { label: "B", estimate: 1, readout: "B · 1.00" },
        ]}
        defaultFocus={0}
      />,
      "A · 2.00 (1.00 to 3.00)",
    ],
  ])("%s becomes interactive with readouts and names its focus", (_, node, readout) => {
    const out = html(node);
    expect(out).toContain('role="group"');
    expect(out).toContain('aria-live="polite"');
    expect(out).toContain(readout);
  });

  test("lines and bars carry the draw-in, empty outlines do not", () => {
    const out = weekly(["a", "b", "c"]);
    expect(out).toContain("kit-grow");
    expect(out).toContain("kit-draw");
    const empty = html(
      <WeeklyBars
        category="steps"
        state="empty"
        values={[1, 2]}
        average={1}
        caption="x"
        hero="x"
      />,
    );
    expect(empty).not.toContain("kit-grow");
  });

  test("dimmed steps back every mark but the focused one", () => {
    expect(dimmed(null, 2)).toBeUndefined();
    expect(dimmed(2, 2)).toBeUndefined();
    expect(dimmed(2, 1)).toBe(0.4);
  });
});

describe("insight card options", () => {
  test("an interactive body is not hidden", () => {
    const out = html(
      <InsightCard category="steps" label="Steps" sentence="x" interactive>
        <span>chart</span>
      </InsightCard>,
    );
    expect(out).not.toContain('aria-hidden="true"><span>chart');
    expect(out).toContain("<span>chart</span>");
  });

  test("ranges render a Day / Week / Month switch with the choice pressed", () => {
    const out = html(
      <InsightCard
        category="steps"
        label="Steps"
        sentence="x"
        ranges={{ value: "week", onChange: () => undefined }}
      />,
    );
    expect(out).toContain('aria-label="Steps: range"');
    for (const word of ["Day", "Week", "Month"]) expect(out).toContain(`>${word}<`);
    expect(out).toMatch(/aria-pressed="true"[^>]*>Week</);
  });

  test("ranges can offer fewer choices", () => {
    const out = html(
      <InsightCard
        category="steps"
        label="Steps"
        sentence="x"
        ranges={{ value: "day", onChange: () => undefined, options: ["day", "week"] }}
      />,
    );
    expect(out).not.toContain(">Month<");
  });
});
