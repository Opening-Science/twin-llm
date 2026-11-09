import { describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ComparisonPair,
  DeviceList,
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
  detailLine,
  radar,
  radarHeight,
  type ChartState,
  withUnit,
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

describe("tap to focus", () => {
  test.each([
    [
      "C07",
      <StreakGrid
        key="c07"
        category="activity"
        days={[
          { date: "2026-11-01", done: true, readout: "1 Nov · active" },
          { date: "2026-11-02", done: false, readout: "2 Nov · not active" },
        ]}
        today="2026-11-02"
        defaultFocus={1}
      />,
      "2 Nov · not active",
    ],
    [
      "C09",
      <Hypnogram
        key="c09"
        category="sleep"
        spans={[
          { stage: "deep", start: 60, end: 90, readout: "Deep · 1:00 to 1:30" },
          { stage: "core", start: 0, end: 60, readout: "Core · 0:00 to 1:00" },
        ]}
        defaultFocus={0}
      />,
      // Blocks are focused in time order, whatever order the spans came in.
      "Core · 0:00 to 1:00",
    ],
    [
      "C10",
      <ScoreRing
        key="c10"
        category="sleep"
        title="Sleep score"
        band="High"
        parts={[
          { label: "Duration", value: 45, max: 50, readout: "Duration · 45 of 50" },
          { label: "Bedtime", value: 25, max: 30, readout: "Bedtime · 25 of 30" },
        ]}
        defaultFocus={1}
      />,
      "Bedtime · 25 of 30",
    ],
    [
      "C18",
      <Radar
        key="c18"
        category="sleep"
        axes={[
          {
            label: "REM",
            value: 96,
            display: "1 hr 36 min",
            max: 150,
            readout: "REM · 1 hr 36 min",
          },
          {
            label: "Deep",
            value: 70,
            display: "1 hr 10 min",
            max: 120,
            readout: "Deep · 1 hr 10 min",
          },
          {
            label: "Core",
            value: 248,
            display: "4 hr 8 min",
            max: 330,
            readout: "Core · 4 hr 8 min",
          },
        ]}
        defaultFocus={2}
      />,
      "Core · 4 hr 8 min",
    ],
  ])("%s pins its focus, names it and marks every mark tappable", (_, node, readout) => {
    const out = html(node);
    expect(out.match(/role="group"/g)).toHaveLength(1);
    expect(out).toContain('aria-live="polite"');
    expect(out).toContain(readout);
    expect(out).toContain('data-focus-index="0"');
    expect(out).toContain('data-focus-index="1"');
  });

  test("without readouts the tap charts stay pictures", () => {
    const out =
      html(charts("default").hypnogram) +
      html(charts("default").ring) +
      html(charts("default").streak);
    expect(out).not.toContain('role="group"');
    expect(out).not.toContain("data-focus-index");
  });

  test("weekly bars take a tap as well as a scrub", () => {
    const out = html(
      <WeeklyBars
        category="steps"
        values={[6, 8]}
        readouts={["Mon · 6", "Tue · 8"]}
        average={7}
        caption="x"
        hero="x"
        defaultFocus={0}
      />,
    );
    expect(out).toContain("Mon · 6");
  });
});

describe("text never fades below AA", () => {
  /** Every text-carrying element that has an opacity of its own. */
  const fadedText = (out: string): readonly string[] =>
    out.match(/<(text|tspan|li|span|p)\b[^>]*(opacity|style="[^"]*opacity)[^>]*>/g) ?? [];

  const focused = {
    weekly: (
      <WeeklyBars
        category="steps"
        values={[6, 8, 7]}
        readouts={["Mon · 6", "Tue · 8", "Wed · 7"]}
        average={7}
        caption="x"
        hero="x"
        defaultFocus={1}
      />
    ),
    streak: (
      <StreakGrid
        category="activity"
        days={[
          { date: "2026-11-01", done: true, readout: "1 Nov · active" },
          { date: "2026-11-02", done: true, readout: "2 Nov · active" },
        ]}
        today="2026-11-02"
        defaultFocus={1}
      />
    ),
    ring: (
      <ScoreRing
        category="sleep"
        title="Sleep score"
        band="High"
        parts={[
          { label: "Duration", value: 45, max: 50, readout: "Duration · 45 of 50" },
          { label: "Bedtime", value: 25, max: 30, readout: "Bedtime · 25 of 30" },
        ]}
        defaultFocus={0}
      />
    ),
    radar: (
      <Radar
        category="heart"
        axes={[
          {
            label: "Resting",
            value: 58,
            display: "58 bpm",
            max: 100,
            readout: "Resting · 58 bpm",
          },
          {
            label: "Sleeping",
            value: 52,
            display: "52 bpm",
            max: 100,
            readout: "Sleeping · 52 bpm",
          },
          {
            label: "Walking",
            value: 96,
            display: "96 bpm",
            max: 160,
            readout: "Walking · 96 bpm",
          },
        ]}
        defaultFocus={2}
      />
    ),
    research: (
      <ResearchFigure
        kind="estimates"
        category="vitals"
        estimates={[
          { label: "Within person", estimate: 3, readout: "Within person · 3" },
          { label: "Shuffled", estimate: 1, readout: "Shuffled · 1" },
        ]}
        defaultFocus={0}
      />
    ),
  };

  test.each(Object.entries(focused))("%s: no text carries an opacity", (_, node) => {
    expect(fadedText(html(node))).toEqual([]);
  });

  test("dimmed labels take the muted colour, the focused one stays foreground", () => {
    const radar = html(focused.radar);
    expect(radar).toMatch(/fill-muted-foreground[^>]*>Resting</);
    expect(radar).toMatch(/fill-foreground[^>]*>Walking</);
    const research = html(focused.research);
    expect(research).toMatch(/fill-muted-foreground[^>]*>Shuffled</);
    expect(research).toMatch(/fill-foreground[^>]*>Within person</);
  });

  test("a done day that steps back is an outline with a muted number", () => {
    const out = html(focused.streak);
    expect(out).toContain("border-current");
    expect(out).toMatch(/text-muted-foreground font-bold[^>]*>1</);
  });

  test("marks still step back", () => {
    expect(html(focused.weekly)).toContain('fill-opacity="0.4"');
    expect(html(focused.radar)).toContain('fill-opacity="0.4"');
  });
});

describe("device list", () => {
  const logo = {
    src: "/brand/vendors/example.svg",
    alt: "Example",
    width: 120,
    height: 30,
  };

  test("rows with names, details, status words and a link with a chevron", () => {
    const out = html(
      <DeviceList
        category="vitals"
        title="Devices"
        rows={[
          {
            name: "Ring",
            detail: "Synced 4 minutes ago",
            status: { word: "Linked", tone: "ok" },
            href: "/wearables",
          },
          { name: "Band", status: { word: "Not synced", tone: "warn" } },
        ]}
      />,
    );
    expect(out).toContain("Devices");
    expect(out).toContain("Synced 4 minutes ago");
    expect(out).toContain("Linked");
    expect(out).toContain("Not synced");
    expect(out).toContain('href="/wearables"');
    expect(out.match(/<svg/g)).toHaveLength(1);
  });

  test("no logo anywhere, no tile column", () => {
    const out = html(
      <DeviceList category="vitals" title="Devices" rows={[{ name: "Ring" }]} />,
    );
    expect(out).not.toContain("<img");
    expect(out).not.toContain("bg-muted size-10");
  });

  test("a logo is the vendor's file at 30px, in its own proportions, on a tile", () => {
    const out = html(
      <DeviceList
        category="vitals"
        title="Devices"
        rows={[{ name: "Ring", logo }, { name: "Band" }]}
      />,
    );
    expect(out.match(/<img/g)).toHaveLength(1);
    expect(out).toContain('alt="Example"');
    expect(out).toContain('src="/brand/vendors/example.svg"');
    expect(out).toContain('width="120"');
    expect(out).toContain('height="30"');
    // Every row leads with a tile, logo or not, so the names line up.
    expect(out.match(/bg-muted flex h-11/g)).toHaveLength(2);
  });

  test("the vendor's attribution leads the detail line, with its name", () => {
    const row = {
      name: "WHOOP",
      detail: "synced 2 hours ago",
      logo: { ...logo, attribution: "Data by" },
    };
    expect(detailLine(row)).toBe("Data by WHOOP · synced 2 hours ago");
    expect(detailLine({ name: "Oura", detail: "synced 4 min ago" })).toBe(
      "synced 4 min ago",
    );
    expect(detailLine({ name: "Oura" })).toBeNull();
    const out = html(<DeviceList category="vitals" title="Devices" rows={[row]} />);
    expect(out).toContain("Data by WHOOP · synced 2 hours ago");
  });

  test("the detail line wraps rather than cutting off", () => {
    const out = html(
      <DeviceList
        category="vitals"
        title="Devices"
        rows={[{ name: "Ring", detail: "a long detail line" }]}
      />,
    );
    expect(out).toMatch(
      /text-muted-foreground block text-xs leading-snug">a long detail line/,
    );
  });

  test("a dark version shows per theme", () => {
    const out = html(
      <DeviceList
        category="vitals"
        title="Devices"
        rows={[
          { name: "Ring", logo: { ...logo, darkSrc: "/brand/vendors/example-dark.svg" } },
        ]}
      />,
    );
    expect(out.match(/<img/g)).toHaveLength(2);
    expect(out).toContain("example-dark.svg");
  });

  test("loading shows row shapes, empty says what is needed", () => {
    const loading = html(
      <DeviceList
        category="vitals"
        state="loading"
        title="Devices"
        rows={[{ name: "Ring" }]}
      />,
    );
    expect(loading).toContain('aria-busy="true"');
    expect(loading).not.toContain("Ring");
    const empty = html(
      <DeviceList
        category="vitals"
        state="empty"
        title="Devices"
        rows={[]}
        emptyNote="No device linked yet"
      />,
    );
    expect(empty).toContain("No device linked yet");
  });
});

describe("research figure options", () => {
  test("rows of one series share a colour, and a legend names each series", () => {
    const out = html(
      <ResearchFigure
        kind="estimates"
        category="vitals"
        estimates={[
          { label: "General", estimate: 0.6, series: "qwen3:8b" },
          { label: "General ", estimate: 0.5, series: "qwen3:4b" },
          { label: "Heart", estimate: 0.7, series: "qwen3:8b" },
        ]}
      />,
    );
    expect(out).toContain("qwen3:8b");
    expect(out).toContain("qwen3:4b");
    // Two 8b rows in chart-1, one 4b row in chart-2.
    expect(out.match(/<g class="text-chart-1">/g)).toHaveLength(2);
    expect(out.match(/<g class="text-chart-2">/g)).toHaveLength(1);
  });

  test("a log axis reads as ratios", () => {
    const out = html(
      <ResearchFigure
        kind="estimates"
        category="vitals"
        scale="log"
        estimates={[{ label: "Within person", estimate: 3.09, low: 2.07, high: 4.63 }]}
        reference={{ value: 1, label: "1 = no difference" }}
      />,
    );
    for (const tick of [">1<", ">2<", ">4<", ">8<"]) expect(out).toContain(tick);
    expect(out).not.toContain(">1.0<");
  });

  test("an expected value is a tick on its row, named in the legend", () => {
    const out = html(
      <ResearchFigure
        kind="estimates"
        category="vitals"
        estimates={[{ label: "Rule change", estimate: 3.95, expected: 3.93 }]}
      />,
    );
    expect(out).toContain("Expected");
    expect(out).toMatch(/stroke-chart-reference" stroke-width="2"/);
  });

  test("the reference label carries the card outline", () => {
    const out = html(
      <ResearchFigure
        kind="estimates"
        category="vitals"
        estimates={[{ label: "A", estimate: 2 }]}
        reference={{ value: 1, label: "1 = no difference" }}
      />,
    );
    expect(out).toMatch(/stroke-card"[^>]*paint-order="stroke"[^>]*>1 = no difference/);
  });

  test("a null from its summary is a band with its mean and words", () => {
    const out = html(
      <ResearchFigure
        kind="null"
        category="vitals"
        summary={{ mean: 0.5, low: 0.46, high: 0.54, runs: 200 }}
        nullLabel="Shuffled, 200 runs"
        observed={0.61}
        observedLabel="AUC"
      />,
    );
    expect(out).toContain("Shuffled, 200 runs");
    expect(out).toContain("AUC 0.61");
    expect(out).toContain('fill-opacity="0.35"');
  });

  test("a series colour replaces the category's on the figure and its card", () => {
    const figure = html(
      <ResearchFigure
        kind="estimates"
        category="vitals"
        series="chart-3"
        estimates={[
          { label: "A", estimate: 1 },
          { label: "B", estimate: 2 },
        ]}
      />,
    );
    expect(figure.match(/<g class="text-chart-3">/g)).toHaveLength(2);
    const card = html(
      <InsightCard category="vitals" series="chart-4" label="P2" sentence="x" />,
    );
    expect(card).toContain("text-chart-4");
    expect(card).not.toContain("text-chart-1");
  });
});

describe("device list options", () => {
  const logo = {
    src: "/brand/vendors/example.svg",
    alt: "Example",
    width: 30,
    height: 30,
    attribution: "Data by",
  };

  test("a row can end in actions; with a link, only the name links", () => {
    const out = html(
      <DeviceList
        category="vitals"
        title="Devices"
        rows={[
          {
            name: "Band",
            href: "/wearables/band",
            actions: (
              <>
                <button type="button">Refresh</button>
                <button type="button">Unlink</button>
              </>
            ),
          },
        ]}
      />,
    );
    expect(out).toContain(">Refresh</button>");
    expect(out).toContain(">Unlink</button>");
    // The link holds the name only, never the buttons.
    expect(out).toMatch(/<a [^>]*href="\/wearables\/band"[^>]*>Band<\/a>/);
    const link = /<a [^>]*>(.*?)<\/a>/.exec(out)?.[1] ?? "";
    expect(link).toBe("Band");
    expect(out).not.toContain("<svg");
  });

  test("a row can leave out the logo's attribution word, keeping the logo", () => {
    const out = html(
      <DeviceList
        category="vitals"
        title="Devices"
        rows={[{ name: "WHOOP", detail: "Not linked", logo, hideAttribution: true }]}
      />,
    );
    expect(out).not.toContain("Data by");
    expect(out).toContain("<img");
    expect(out).toContain("Not linked");
    expect(detailLine({ name: "WHOOP", logo })).toBe("Data by WHOOP");
  });

  test("without a title and a frame the rows sit on their parent", () => {
    const out = html(
      <DeviceList
        category="vitals"
        framed={false}
        rows={[{ name: "Ring" }, { name: "Band" }]}
      />,
    );
    expect(out).not.toContain("<h3");
    expect(out).not.toContain("surface rounded-card");
    expect(out).toContain("border-border border-t");
  });
});

test("the consistency chart draws its usual band, named", () => {
  const out = html(
    <Consistency
      category="sleep"
      values={[1380, 1410, 1395]}
      target={1395}
      floor={1320}
      usual={{ low: 1370, high: 1420 }}
      reference={{ label: "Usual bedtime", value: "23:04" }}
      last={{ label: "Last night", value: "23:15" }}
    />,
  );
  expect(out).toContain(">Usual<");
  expect(out).toContain('fill-opacity="0.18"');
});

describe("hypnogram options", () => {
  test("totals only: one bar per lane, its total, no times and no keys", () => {
    const out = html(
      <Hypnogram
        category="sleep"
        totals={{ awake: 25, rem: 96, core: 248, deep: 70 }}
        axis={["23:04", "06:23"]}
      />,
    );
    for (const word of ["Awake", "REM", "Core", "Deep"]) expect(out).toContain(word);
    expect(out).toContain("4 hr 8 min");
    expect(out).toContain("1 hr 10 min");
    expect(out.match(/fill-stage-/g)).toHaveLength(4);
    expect(out).not.toContain("23:04");
    expect(out).not.toContain('role="group"');
  });

  test("the core lane can say Light, and labels still win", () => {
    const light = html(
      <Hypnogram category="sleep" coreWord="Light" totals={{ core: 200 }} />,
    );
    expect(light).toContain(">Light<");
    expect(light).not.toContain(">Core<");
    const custom = html(
      <Hypnogram
        category="sleep"
        coreWord="Light"
        labels={{ core: "Light sleep" }}
        totals={{ core: 200 }}
      />,
    );
    expect(custom).toContain(">Light sleep<");
  });
});

test("a radar with inverted axes says so under itself, and only then", () => {
  const axes = [
    { label: "Resting", value: 58, display: "58 bpm", min: 50, max: 66, inverted: true },
    { label: "Walking", value: 96, display: "96 bpm", min: 80, max: 110 },
    { label: "HRV", value: 47, display: "47 ms", min: 30, max: 60 },
  ];
  expect(html(<Radar category="heart" axes={axes} />)).toContain(
    "For resting, further out means lower.",
  );
  expect(
    html(<Radar category="heart" axes={axes.map((a) => ({ ...a, inverted: false }))} />),
  ).not.toContain("further out");
});

describe("units and durations", () => {
  test("MIN and MAX carry the unit when given", () => {
    const out = html(
      <RangeBars
        category="heart"
        unit="bpm"
        buckets={[
          { min: 56, max: 92 },
          { min: 61, max: 114 },
        ]}
      />,
    );
    expect(out).toContain("MAX 114 bpm");
    expect(out).toContain("MIN 56 bpm");
    expect(withUnit("114", undefined)).toBe("114");
  });

  test("stage totals use the shared duration: a whole hour reads 7 hr", () => {
    expect(hoursMinutes(420)).toBe("7 hr");
    expect(hoursMinutes(424)).toBe("7 hr 4 min");
  });
});

describe("heading levels", () => {
  test("cards head with h3 unless told to sit deeper or higher", () => {
    expect(html(<InsightCard category="sleep" label="Sleep" sentence="x" />)).toContain(
      "<h3",
    );
    const deeper = html(
      <InsightCard category="sleep" label="Sleep" sentence="x" headingLevel={4} />,
    );
    expect(deeper).toContain("<h4");
    expect(deeper).not.toContain("<h3");
    const lab = html(
      <LabResultCard
        category="vitals"
        headingLevel={2}
        title="Audit chain"
        outcome={{ word: "Intact", tone: "pass" }}
        sentence="x"
        rows={[]}
      />,
    );
    expect(lab).toContain("<h2");
  });
});

describe("research figure axes", () => {
  test("an axis title is written inside the figure, under the ticks", () => {
    const out = html(
      <ResearchFigure
        kind="estimates"
        category="vitals"
        axisTitle="Rate ratio"
        estimates={[{ label: "A", estimate: 2, low: 1, high: 3 }]}
      />,
    );
    expect(out).toContain(">Rate ratio<");
    expect(out.indexOf(">Rate ratio<")).toBeLessThan(out.indexOf("</svg>"));
  });

  test("the null kind has ticks, from draws or a summary", () => {
    const draws = html(
      <ResearchFigure
        kind="null"
        category="vitals"
        draws={[0.48, 0.5, 0.52, 0.49, 0.51]}
        observed={0.6}
        observedLabel="AUC"
        axisTitle="AUC"
      />,
    );
    expect(draws).toContain(">0.50<");
    expect(draws).toContain(">0.60<");
    const summary = html(
      <ResearchFigure
        kind="null"
        category="vitals"
        summary={{ mean: 0.5, low: 0.46, high: 0.54, runs: 200 }}
        observed={0.61}
        observedLabel="AUC"
      />,
    );
    expect(summary).toMatch(/>0\.\d0</);
  });
});

test("an empty day with no usual day yet still outlines a day, never a blank", () => {
  const out = html(
    <CumulativeDay category="steps" state="empty" today={[]} average={[]} now={0} />,
  );
  const outline = /<path d="(M[^"]+)"[^>]*stroke-dasharray="2 6"/.exec(out);
  expect(outline?.[1]?.split("L").length).toBeGreaterThan(20);
  // The placeholder is half as strong as a real usual day's outline.
  expect(out).toContain('stroke-opacity="0.5"');
  const usual = html(
    <CumulativeDay
      category="steps"
      state="empty"
      today={[]}
      average={[
        { at: 0, value: 0 },
        { at: 1, value: 8000 },
      ]}
      now={0}
    />,
  );
  expect(usual).not.toContain('stroke-opacity="0.5"');
});
