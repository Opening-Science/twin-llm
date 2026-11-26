import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ReplayProvider } from "../replay/replay-provider";
import { YourDayChart } from "./your-day-chart";
import { chartUnit, plottedValueAt, type YourDayChartId } from "./your-day-charts";
import { yourDayReplayFixtures } from "./your-day-replay-demo";

const fixtures = yourDayReplayFixtures();

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
  return renderToStaticMarkup(
    <ReplayProvider selection={fixture.selection}>
      <YourDayChart id={id} data={fixture.chartData} onRemove={() => {}} />
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

test("renders supported nightly reference bands with a text alternative", () => {
  const html = renderChart("hrv_rmssd", "2026-10-27");
  expect(html).toContain("Derived reference band:");
  expect(html).toContain("<rect");
});

test("shows per-minute heart streams as bpm and keeps other stream units", () => {
  expect(chartUnit("heart_rate")).toBe("bpm");
  expect(chartUnit("resting_heart_rate")).toBe("bpm");
  expect(chartUnit("glucose")).toBe("mg/dL");
  expect(chartUnit("hrv_rmssd")).toBe("ms");
});
