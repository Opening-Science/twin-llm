import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { YourDayLayout } from "./your-day-layout";
import { YourDayViewer } from "./your-day-viewer";

test("lays out the replay slots and sample charts without playback controls", () => {
  const html = renderToStaticMarkup(
    <YourDayLayout>
      <p>Existing viewer is unavailable.</p>
    </YourDayLayout>,
  );
  expect(html).toContain('aria-label="Previous day"');
  expect(html).toContain('aria-label="Next day"');
  expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*>.*Replay date/);
  expect(html).not.toContain('type="date"');
  expect(html).toMatch(/<header[^>]*>.*<h2[^>]*>Replay Clock<\/h2>.*--:--.*<\/header>/);
  expect(html.match(/Replay Clock/g)).toHaveLength(1);
  expect(html).not.toContain(">Your Day</h2>");
  expect(html.indexOf("Existing viewer")).toBeLessThan(html.indexOf("Biomarker charts"));
  expect(html.indexOf("Biomarker charts")).toBeLessThan(html.indexOf("Daily replay"));
  expect(html).toContain(">Heart rate</h4>");
  expect(html).toContain(">Heart rate variability</h4>");
  expect(html.match(/Sample data/g)).toHaveLength(2);
  expect(html.match(/Daily range/g)).toHaveLength(2);
  expect(html.match(/type="range"/g)).toHaveLength(2);
  expect(html).toContain("Not yet available");
  expect(html).not.toMatch(/Add biomarker|Remove (Heart rate|chart)|Play replay/);
  expect(html).not.toContain(">Anatomy</h3>");
});

test("the atlas viewport has an accessible name and no on-screen controls", () => {
  const html = renderToStaticMarkup(<YourDayViewer />);
  expect(html).toContain('role="img" aria-label="Organ-level 3D reference anatomy"');
  expect(html).not.toMatch(/<(button|select|input|summary|h[1-6])\b/);
  expect(html).not.toContain("tabindex=");
});
