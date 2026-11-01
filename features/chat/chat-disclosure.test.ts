import { describe, expect, test } from "bun:test";

import { offeredKeys } from "@/infrastructure/offered-keys";

import { chatDisclosure, numberReviewDisclosure } from "./chat-disclosure";

const WINDOW = { startDate: "2026-07-10", endDate: "2026-07-10" };

const WEARABLES = {
  oura: {
    window: WINDOW,
    narrative: "Synthetic Oura window.",
    metrics: [
      { key: "oura.sleep.score.2026-07-10", label: "Sleep score", value: 81 },
      { key: "oura.hrv.2026-07-10", label: "HRV", value: 42 },
    ],
  },
  whoop: null,
  googleHealth: null,
  vitronic: null,
};

const NONE = { oura: null, whoop: null, googleHealth: null, vitronic: null };

describe("chatDisclosure (#140)", () => {
  test("a personal turn with wearables lists the injected keys as references, no values", () => {
    const disclosure = chatDisclosure({
      actor: "user_synthetic_1",
      turnId: "turn-synthetic-1",
      threadId: "thread-synthetic-1",
      mode: "personal",
      messageCount: 3,
      wearables: WEARABLES,
      noteIds: ["note-synthetic-1"],
      hasTools: true,
    });
    expect(disclosure).toEqual({
      actor: "user_synthetic_1",
      sessionId: "turn-synthetic-1",
      threadId: "thread-synthetic-1",
      purpose: "chat answer",
      categories: [
        "question text",
        "earlier messages",
        "wearable summary",
        "twin notes",
        "tool results",
      ],
      refs: [
        { source: "wearable", key: "oura.sleep.score.2026-07-10" },
        { source: "wearable", key: "oura.hrv.2026-07-10" },
        { source: "note", key: "note-synthetic-1" },
      ],
      synthetic: false,
    });
    expect(
      disclosure.refs.filter((ref) => ref.source === "wearable").map((ref) => ref.key),
    ).toEqual([...offeredKeys(WEARABLES)]);
    expect(JSON.stringify(disclosure)).not.toContain("81");
  });

  test("a first synthetic question without tools is only the question, labelled synthetic", () => {
    expect(
      chatDisclosure({
        actor: "local",
        turnId: "turn-synthetic-2",
        threadId: null,
        mode: "synthetic",
        messageCount: 1,
        wearables: NONE,
        noteIds: [],
        hasTools: false,
      }),
    ).toEqual({
      actor: "local",
      sessionId: "turn-synthetic-2",
      threadId: null,
      purpose: "chat answer",
      categories: ["question text"],
      refs: [],
      synthetic: true,
    });
  });

  test("wearable context makes a synthetic-mode turn personal", () => {
    expect(
      chatDisclosure({
        actor: "local",
        turnId: "t",
        threadId: null,
        mode: "synthetic",
        messageCount: 1,
        wearables: WEARABLES,
        noteIds: [],
        hasTools: false,
      }).synthetic,
    ).toBe(false);
  });
});

describe("numberReviewDisclosure (#366)", () => {
  test("the number check sends the answer and tool results, no references", () => {
    const turn = chatDisclosure({
      actor: "user_synthetic_1",
      turnId: "turn-synthetic-1",
      threadId: "thread-synthetic-1",
      mode: "personal",
      messageCount: 3,
      wearables: WEARABLES,
      noteIds: ["note-synthetic-1"],
      hasTools: true,
    });
    expect(numberReviewDisclosure(turn)).toEqual({
      ...turn,
      purpose: "number check",
      categories: ["answers", "tool results"],
      refs: [],
    });
  });
});
