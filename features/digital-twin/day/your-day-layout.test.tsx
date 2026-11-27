import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { YourDayLayout } from "./your-day-layout";
import { discoverYourDayCharts, type YourDayChartId } from "./charts/your-day-charts";
import { observationCharts } from "./charts/your-day-observations";
import { yourDayReplayFixtures } from "./data/your-day-replay-demo";
import { YourDayViewer } from "./your-day-viewer";

const demoDays = yourDayReplayFixtures();
const chartIds = discoverYourDayCharts(
  demoDays.map(({ chartData }) => chartData.day),
).map(({ id }) => id);
const { subject_ref, time_zone } = demoDays[0]!.selection;
const demoIdentity = { subject_ref, time_zone };

test("selects an Anchor lab observation as a replay chart without a predefined stream", () => {
  const charts = observationCharts(
    demoDays.flatMap(({ observations }) => observations ?? []),
  );
  const ferritin = charts.find(({ label }) => label === "Ferritin")!;
  const html = renderToStaticMarkup(
    <YourDayLayout
      initialDate="2026-10-27"
      demoDays={demoDays}
      demoIdentity={demoIdentity}
      initialChartIds={[ferritin.id]}
    >
      <p>Viewer</p>
    </YourDayLayout>,
  );
  expect(html).toContain(">Ferritin</h4>");
  expect(html).toContain("Last recorded at 08:40");
  expect(html).toContain("measured · Synthetic demo lab");
  expect(html).toContain("Synthetic demo</p>");
  expect(html).toContain("data-replay-observation");
  expect(html).not.toContain("<polyline");
});

test("renders replay controls and events before playback begins", () => {
  const html = renderToStaticMarkup(
    <YourDayLayout
      initialDate="2026-10-27"
      demoDays={demoDays}
      demoIdentity={demoIdentity}
    >
      <p>Existing viewer is unavailable.</p>
    </YourDayLayout>,
  );
  expect(html).toContain('aria-label="Previous day"');
  expect(html).toContain('aria-label="Next day"');
  expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*>.*Replay date/);
  expect(html).not.toContain('type="date"');
  expect(html).toMatch(/<header[^>]*>.*<h2[^>]*>Replay Clock<\/h2>.*00:00.*<\/header>/);
  expect(html).toMatch(/font-mono[^"]*text-chart-4">00:00/);
  expect(html).toMatch(
    /class="sr-only">Sleep: Sleep; Heart rate: Sleep; Glucose: Overnight fasting</,
  );
  expect(html).not.toContain("overlapping events");
  expect(html.match(/Replay Clock/g)).toHaveLength(1);
  expect(html).not.toContain(">Your Day</h2>");
  expect(html.indexOf("Existing viewer")).toBeLessThan(html.indexOf("Biomarker charts"));
  expect(html.indexOf("Biomarker charts")).toBeLessThan(html.indexOf("Daily replay"));
  expect(html).toContain(">Heart rate</h4>");
  expect(html).toContain(">Glucose</h4>");
  expect(html).toContain("mg/dL");
  expect(chartIds).toHaveLength(6);
  expect(html.match(/<p>Synthetic demo<\/p>/g)).toHaveLength(6);
  expect(html.match(/Daily range/g)).toHaveLength(3);
  expect(html.match(/type="range"/g)).toHaveLength(5);
  expect(html).toContain('aria-label="Play"');
  expect(html.match(/data-replay-track/g)).toHaveLength(1);
  expect(html).toContain('aria-label="Replay speed"');
  for (const kind of ["Sleep", "Heart rate", "Glucose"]) {
    expect(html).toContain(`aria-label="Seek to ${kind}:`);
  }
  expect(html).toContain('aria-label="Event types"');
  for (const [icon, label] of [
    ["dumbbell", "Workout"],
    ["person-standing", "Activity"],
    ["moon", "Sleep"],
    ["heart-pulse", "Heart rate"],
    ["droplet", "Glucose"],
  ]) {
    expect(html).toMatch(
      new RegExp(
        `<li[^>]*class="[^"]*items-center[^"]*"[^>]*><svg[^>]*class="[^"]*lucide-${icon}[^"]*"[^>]*>.*?</svg><span>${label}</span></li>`,
      ),
    );
  }
  expect(html).toContain(">Demo data</span>");
  expect(html).not.toMatch(/Event details|Synthetic demonstration/);
  expect(html).toContain('aria-label="Remove Heart rate chart"');
  expect(html).toMatch(
    /<header[^>]*>.*Replay date.*aria-haspopup="dialog"[^>]*>.*?Add biomarkers<\/button>/,
  );
  expect(html).not.toContain(">Anatomy</h3>");
});

test("shows an empty state without old events or charts on a non-demo date", () => {
  const html = renderToStaticMarkup(
    <YourDayLayout
      initialDate="2026-11-25"
      demoDays={demoDays}
      demoIdentity={demoIdentity}
    >
      <p>Viewer is still available.</p>
    </YourDayLayout>,
  );
  expect(html).toContain("Viewer is still available.");
  expect(html).toContain("No demo replay data for this date.");
  expect(html).toMatch(/font-mono[^"]*text-foreground">--:--/);
  expect(html).toMatch(/<header[^>]*>.*<circle cx="8" cy="8" r="6">/);
  expect(html).toContain("No readings for this day.");
  expect(html).not.toMatch(/Seek replay time|Seek to |<p>Synthetic demo<\/p>/);
});

test("supports zero or six distinct cards independently of the replay controls", () => {
  const render = (initialChartIds: readonly YourDayChartId[]) =>
    renderToStaticMarkup(
      <YourDayLayout
        initialDate="2026-10-27"
        demoDays={demoDays}
        demoIdentity={demoIdentity}
        initialChartIds={initialChartIds}
      >
        <p>Viewer</p>
      </YourDayLayout>,
    );
  const empty = render([]);
  expect(empty).toContain("Add charts to see biomarker readings here.");
  expect(empty).toContain('aria-label="Seek replay time"');
  expect(empty).toContain("0 of 6 charts selected");
  expect(empty).toContain('aria-disabled="true"');
  expect(empty).toContain('aria-label="Why is Sleep unavailable?"');
  expect(empty).toMatch(
    /<button(?=[^>]*aria-label="Why is Alanine aminotransferase unavailable\?")(?=[^>]*aria-expanded="false")[^>]*>/,
  );
  expect(empty).toContain('aria-label="Biomarker results pages"');
  expect(empty).toContain('aria-current="page"');
  expect(empty).toContain('aria-label="Go to first page"');
  expect(empty).toContain('aria-label="Go to last page"');
  const two = render(["heart_rate", "glucose"]);
  expect(two).toContain("2 of 6 charts selected");
  expect(two.match(/<input[^>]*type="checkbox"[^>]*checked=""/g)).toHaveLength(2);
  expect(render([...chartIds, ...chartIds]).match(/aria-label="Remove /g)).toHaveLength(
    6,
  );
});

test("the atlas viewport has an accessible name and no on-screen controls", () => {
  const html = renderToStaticMarkup(<YourDayViewer />);
  expect(html).toContain('role="img" aria-label="Organ-level 3D reference anatomy"');
  expect(html).not.toMatch(/<(button|select|input|summary|h[1-6])\b/);
  expect(html).not.toContain("tabindex=");
});
