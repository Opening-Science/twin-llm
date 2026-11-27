import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ReplayProvider } from "../../replay/replay-provider";
import { YourDayChart } from "./your-day-chart";
import { chartPresentation } from "./your-day-chart-units";
import {
  discoverYourDayCharts,
  plottedValueAt,
  type YourDayChartId,
} from "./your-day-charts";
import { observationCharts } from "./your-day-observations";
import { yourDayReplayFixtures } from "../data/your-day-replay-demo";

const fixtures = yourDayReplayFixtures();
const charts = discoverYourDayCharts(fixtures.map(({ chartData }) => chartData.day));

test("the cursor dot follows plotted segments without crossing gaps", () => {
  const segments = [
    [
      { ms: 10, value: 20 },
      { ms: 20, value: 40 },
    ],
    [{ ms: 40, value: 0 }],
  ];
  expect(plottedValueAt(segments, 9)).toBeNull();
  expect(plottedValueAt(segments, 10)).toBe(20);
  expect(plottedValueAt(segments, 15)).toBe(30);
  expect(plottedValueAt(segments, 20)).toBe(40);
  expect(plottedValueAt(segments, 30)).toBeNull();
  expect(plottedValueAt(segments, 40)).toBe(0);
  expect(plottedValueAt(segments, 41)).toBeNull();
});
const renderChart = (id: YourDayChartId, day: string) => {
  const fixture = fixtures.find(({ selection }) => selection.day === day)!;
  const chart = charts.find((chart) => chart.id === id)!;
  return renderToStaticMarkup(
    <ReplayProvider selection={fixture.selection}>
      <YourDayChart chart={chart} data={fixture.chartData} onRemove={() => {}} />
    </ReplayProvider>,
  );
};

test("plots sensor runs without bridging gaps and labels the cursor, units and provenance", () => {
  const html = renderChart("glucose", "2026-10-27");
  expect(html).toMatch(
    /<header[^>]*>.*Daily range.*mg\/dL.*Remove Glucose chart.*<\/header>/,
  );
  expect(html).toMatch(
    /<div class="sr-only"><p>Synthetic demo<\/p><p>measured.*Synthetic glucose sensor.*data gap.*<\/div>/,
  );
  expect(html).toMatch(/aria-valuetext="00:00 UTC\+01:00, \d+ mg\/dL"/);
  expect(html.match(/<polyline/g)).toHaveLength(2);
  expect(html).toContain("00:00 UTC+01:00");
  expect(html).toContain("23:59");
});

test("keeps the common axis on days without a glucose stream", () => {
  const html = renderChart("glucose", "2026-10-28");
  expect(html).toContain("No data");
  expect(html).toContain("Not recorded on this day.");
  expect(html).toContain("00:00 UTC+01:00");
  expect(html).not.toMatch(/Daily range|<polyline/);
});

test("plots a 25-hour date using elapsed time and local labels", () => {
  const html = renderChart("heart_rate", "2026-10-25");
  expect(html).toContain("00:00 UTC+02:00");
  expect(html).toContain("05:15");
  expect(html).toContain("11:30");
  expect(html).toContain("23:59");
});

test("applies the unit conversion to the rendered value and range", () => {
  const fixture = fixtures.find(({ selection }) => selection.day === "2026-10-27")!;
  const chart = charts.find(({ id }) => id === "heart_rate")!;
  const html = renderToStaticMarkup(
    <ReplayProvider selection={fixture.selection}>
      <YourDayChart
        chart={{ ...chart, view: chartPresentation("/h", chart.label, "sample") }}
        data={fixture.chartData}
        onRemove={() => {}}
      />
    </ReplayProvider>,
  );
  expect(html).toContain("1.0–2.9 bpm");
  expect(html).toContain('aria-valuetext="00:00 UTC+01:00, 1.0 bpm"');
});

test("places converted observation dots on the converted axis", () => {
  const fixture = fixtures.find(({ selection }) => selection.day === "2026-10-27")!;
  const reading = (id: string, at: string, value: number) => ({
    id,
    sourceId: "test-lab",
    source: "Test lab",
    codeSystem: null,
    code: null,
    label: "An analyte",
    unit: "g/L",
    day: "2026-10-27",
    at,
    value,
    timing: "observation" as const,
    interval_min: 0,
  });
  const [chart] = observationCharts([
    reading("first", "2026-10-27T07:00:00.000Z", 0.9),
    reading("second", "2026-10-27T15:00:00.000Z", 1.1),
  ]);
  const html = renderToStaticMarkup(
    <ReplayProvider selection={fixture.selection}>
      <YourDayChart chart={chart!} data={fixture.chartData} onRemove={() => {}} />
    </ReplayProvider>,
  );
  const tops = [...html.matchAll(/data-replay-observation[^>]*top:([\d.-]+)%/g)].map(
    ([, top]) => Number(top),
  );
  expect(html).toContain("90–110.0 mg/dL");
  expect(tops).toHaveLength(2);
  expect(tops.every((top) => top >= 0 && top <= 100)).toBe(true);
});

test("shows nightly values and reference bands without an intraday axis", () => {
  const html = renderChart("hrv_rmssd", "2026-10-27");
  expect(html).toContain('data-replay-chart="nightly-summary"');
  expect(html).toContain("Nightly summary");
  expect(html).toContain("Derived reference band:");
  expect(html).not.toMatch(/23:59|type="range"|<polyline|<rect|Daily range/);
});

test("plots step buckets as bars rather than a connected line", () => {
  const html = renderChart("steps", "2026-10-27");
  expect(html).toContain('data-replay-chart="intervals"');
  expect(html).toMatch(/<rect x="0" width="1\.04/);
  expect(html).not.toContain("<polyline");
});

test("shows the recorded blood observation as one dot at its actual time", () => {
  const html = renderChart("blood_glucose", "2026-10-27");
  expect(html.match(/data-replay-observation/g)).toHaveLength(1);
  expect(html).toContain("Last recorded at 07:25 UTC+01:00");
  expect(html).not.toMatch(/<polyline|Daily range|aria-valuetext="00:00 UTC\+01:00, 98/);
});
