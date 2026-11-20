import { describe, expect, test } from "bun:test";

import type { ChatView } from "@/infrastructure/chat-view";

import type { AnswerState, TurnState } from "./conversation";
import { closeTwinCard, spokenAnswer, twinTurnOf } from "./spoken-turn";
import { focusRequestOf } from "./twin-card";

const heartView = {
  id: "view-1",
  kind: "twin.body",
  title: "Body twin: Heart",
  spec: {
    focus: "heart",
    label: "Heart",
    body: "demo",
    subject: null,
    window: null,
    organs: [],
  },
  sourceAuditIds: ["1"],
} as unknown as ChatView;

const turnWith = (
  answer: Partial<AnswerState>,
  prompt = "Show me my heart.",
): TurnState => ({
  id: "t1",
  prompt,
  answers: [
    {
      id: "t1:m1",
      modelId: "m1",
      modelName: "Model one",
      status: "COMPLETE",
      text: "Answer: Your liver values are in range.",
      metrics: null,
      ...answer,
    },
  ],
});

const spoken = { index: 0, language: "en" } as const;

describe("where the twin turns after a spoken answer", () => {
  test("the body twin the answer drew comes first", () => {
    const found = spokenAnswer([turnWith({ views: [heartView] })], spoken);
    expect(found?.shownFocus).toBe("heart");
    expect(found === null ? null : twinTurnOf(found)).toBe("heart");
  });

  test("else the organ the answer names, then the question's", () => {
    const named = spokenAnswer([turnWith({})], spoken);
    expect(named?.shownFocus).toBeNull();
    expect(named === null ? null : twinTurnOf(named)).toBe("liver");
    const asked = spokenAnswer(
      [turnWith({ text: "Answer: Here it is." }, "Zeig mir meine Nieren.")],
      spoken,
    );
    expect(asked === null ? null : twinTurnOf(asked)).toBe("kidney");
  });

  test("nothing named, no turn", () => {
    const none = spokenAnswer(
      [turnWith({ text: "Answer: You slept seven hours." }, "How did I sleep?")],
      spoken,
    );
    expect(none === null ? null : twinTurnOf(none)).toBeNull();
  });

  test("the card's request lights the organ at the organs depth, once per press", () => {
    expect(focusRequestOf({ id: "heart", at: 7 })).toEqual({
      focus: {
        id: "heart",
        label: "Heart",
        highlights: {
          hra: { kind: "groups", ids: ["heart"] },
          bodyparts3d: { kind: "system", ids: ["cardiovascular"] },
        },
        depth: 3,
      },
      at: 7,
    });
  });
});

describe("closing the twin card", () => {
  test("forgets the spoken turn, so reopening starts afresh, not at the old organ", () => {
    const calls: unknown[] = [];
    closeTwinCard(
      () => calls.push("close"),
      (turn) => calls.push(["turn", turn]),
    );
    expect(calls).toEqual([["turn", null], "close"]);
  });
});
