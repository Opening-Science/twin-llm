import { describe, expect, test } from "bun:test";
import type { CaptureResult } from "posthog-js";

import { PRIVATE_POSTHOG_OPTIONS, scrubEvent, scrubThreadIds } from "./analytics-privacy";

describe("PRIVATE_POSTHOG_OPTIONS", () => {
  test("turns off every capture that can read page content", () => {
    expect(PRIVATE_POSTHOG_OPTIONS).toMatchObject({
      autocapture: false,
      disable_session_recording: true,
      enable_heatmaps: false,
      capture_exceptions: false,
      capture_dead_clicks: false,
      rageclick: false,
      mask_all_text: true,
      mask_all_element_attributes: true,
      persistence: "memory",
    });
  });
});

describe("scrubEvent", () => {
  test("removes thread ids from URL properties and leaves the rest", () => {
    const event = {
      uuid: "e1",
      event: "$pageview",
      properties: {
        $current_url: "http://localhost:3000/t/cmabc123?x=1",
        $pathname: "/t/cmabc123",
        $referrer: "http://localhost:3000/t/cmzzz999/",
        other: "/t/kept-because-not-a-url-property",
      },
    } as unknown as CaptureResult;

    const scrubbed = scrubEvent(event);
    expect(scrubbed?.properties).toEqual({
      $current_url: "http://localhost:3000/t/:id?x=1",
      $pathname: "/t/:id",
      $referrer: "http://localhost:3000/t/:id/",
      other: "/t/kept-because-not-a-url-property",
    });
    expect(event.properties.$pathname).toBe("/t/cmabc123");
  });

  test("passes a dropped event through as null", () => {
    expect(scrubEvent(null)).toBeNull();
  });

  test("scrubThreadIds leaves other paths alone", () => {
    expect(scrubThreadIds("/customize/connectors")).toBe("/customize/connectors");
  });
});
