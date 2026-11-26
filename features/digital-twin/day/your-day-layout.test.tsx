import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { YourDayLayout } from "./your-day-layout";
import { yourDayReplayFixtures } from "./your-day-replay-demo";
import { YourDayViewer } from "./your-day-viewer";

const demoDays = yourDayReplayFixtures();
const { subject_ref, time_zone } = demoDays[0]!.selection;
const demoIdentity = { subject_ref, time_zone };

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
  expect(html).toContain(">Sensor glucose</h4>");
  expect(html).not.toContain("Heart rate variability");
  expect(html).toContain("mg/dL");
  expect(html.match(/Sample data/g)).toHaveLength(2);
  expect(html.match(/Daily range/g)).toHaveLength(2);
  expect(html.match(/type="range"/g)).toHaveLength(3);
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
  expect(html).not.toMatch(/Add biomarker|Remove (Heart rate|chart)/);
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
  expect(html).not.toMatch(/Seek replay time|Seek to |Sample data/);
});

test("the atlas viewport has an accessible name and no on-screen controls", () => {
  const html = renderToStaticMarkup(<YourDayViewer />);
  expect(html).toContain('role="img" aria-label="Organ-level 3D reference anatomy"');
  expect(html).not.toMatch(/<(button|select|input|summary|h[1-6])\b/);
  expect(html).not.toContain("tabindex=");
});
