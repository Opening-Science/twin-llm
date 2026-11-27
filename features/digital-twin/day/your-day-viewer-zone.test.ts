import { expect, test } from "bun:test";

import { withViewerZone } from "./your-day-viewer-zone";

test("adds the viewer's zone and keeps the chosen date", () => {
  expect(
    withViewerZone(
      "https://twin.local/digital-twin/your-day?date=2026-11-26",
      "Europe/Zurich",
    ),
  ).toBe("/digital-twin/your-day?date=2026-11-26&zone=Europe%2FZurich");
});

test("falls back to UTC when the browser reports no zone", () => {
  expect(withViewerZone("https://twin.local/digital-twin/your-day", "")).toBe(
    "/digital-twin/your-day?zone=UTC",
  );
});
