import { describe, expect, test } from "bun:test";

import {
  DASHBOARD_INTRO,
  DASHBOARD_SECTIONS,
  RECENT_CHATS,
  recentChatMeta,
  REPLAY_MY_DAY,
} from "./dashboard-sections";

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

  test("Replay my day has a named place and no link until the replay exists", () => {
    expect(REPLAY_MY_DAY).toEqual({
      id: "replay-my-day",
      title: "Replay my day",
      line: "A day played back on the twin. It opens from here once the replay is built.",
      href: null,
      status: "Coming",
    });
  });

  test("recent chats: how many, the words when there are none, and each one's line", () => {
    expect(RECENT_CHATS.shown).toBe(5);
    expect(RECENT_CHATS.empty).toBe(
      "No conversations yet. Ask a question and it shows here and in the sidebar.",
    );
    expect(RECENT_CHATS.label).toBe("Recent conversations");
    expect(recentChatMeta("2026-11-17T09:00:00.000Z", 1, "UTC")).toBe(
      "17 Nov 2026 · 1 model",
    );
    expect(recentChatMeta("2026-11-16T12:00:00.000Z", 3, "UTC")).toBe(
      "16 Nov 2026 · 3 models",
    );
    expect(recentChatMeta("2026-11-15T12:00:00.000Z", 0, "UTC")).toBe("15 Nov 2026");
  });

  test("a chat's day is the reader's calendar day, not the server's", () => {
    // 00:30 in Berlin on 17 Nov is still 16 Nov in UTC.
    const lateChat = "2026-11-16T23:30:00.000Z";
    expect(recentChatMeta(lateChat, 1, "Europe/Berlin")).toBe("17 Nov 2026 · 1 model");
    expect(recentChatMeta(lateChat, 1, "UTC")).toBe("16 Nov 2026 · 1 model");
    expect(recentChatMeta(lateChat, 1, "America/New_York")).toBe("16 Nov 2026 · 1 model");
  });
});
