import { describe, expect, test } from "bun:test";

import { DASHBOARD_INTRO, DASHBOARD_SECTIONS } from "./dashboard-sections";

describe("dashboard sections", () => {
  test("wearables first, then the twin, then chat, each opening its own page", () => {
    expect(
      DASHBOARD_SECTIONS.map(({ id, title, href, linkLabel }) => [
        id,
        title,
        href,
        linkLabel,
      ]),
    ).toEqual([
      ["wearables", "Wearables", "/customize/connectors", "Open Connectors"],
      ["twin", "Digital Twin", "/digital-twin", "Open the Digital Twin"],
      ["chat", "Chat", "/", "Ask a new question"],
    ]);
  });

  test("each says what it shows in one line", () => {
    expect(DASHBOARD_SECTIONS.map(({ line }) => line)).toEqual([
      "Your linked wearables in the same cards as Connectors. Each card names the device its numbers came from.",
      "The body twin and “Show me my day”, on synthetic people only.",
      "Your recent conversations, and a way to start a new one.",
    ]);
  });

  test("the page says it is research use only", () => {
    expect(DASHBOARD_INTRO).toBe(
      "A first look at the main parts of TwinLLM: your wearables, your digital twin and your conversations. Research use only, not clinical advice.",
    );
  });
});
