import { describe, expect, test } from "bun:test";

import type { ResponseDocumentV1 } from "@/infrastructure/response-document/document-v1";

import type { AnswerState, TurnState } from "./conversation";
import { historyForTurn, modelHistory } from "./model-history";

/** SPEC 8.4, with synthetic prompts only. */

const answer = (modelId: string, over: Partial<AnswerState> = {}): AnswerState => ({
  id: `row-${modelId}`,
  modelId,
  modelName: modelId,
  status: "COMPLETE",
  text: `${modelId} says 72 bpm.`,
  metrics: null,
  ...over,
});

const turn = (
  id: string,
  prompt: string,
  answers: readonly AnswerState[],
  over: Partial<TurnState> = {},
): TurnState => ({
  id,
  prompt,
  answers,
  ...over,
});

const WITHHELD = {
  abstained: true,
  answer_class: "information",
} as unknown as ResponseDocumentV1;
const DECLINED = {
  abstained: false,
  answer_class: "declined_decision_support",
} as unknown as ResponseDocumentV1;

describe("the history each model receives", () => {
  test("its own finished answers only, never another model's", () => {
    const earlier = [
      turn("t1", "Heart rate for subject 29bbf012?", [answer("a"), answer("b")]),
    ];
    expect(modelHistory(earlier, turn("t2", "And sleep?", []), "a")).toEqual([
      { role: "user", content: "Heart rate for subject 29bbf012?" },
      { role: "assistant", content: "a says 72 bpm." },
      { role: "user", content: "And sleep?" },
    ]);
  });

  test("a skill turn reads back as /skill prompt", () => {
    const earlier = [turn("t1", "last week", [answer("a")], { skill: "sleep" })];
    expect(modelHistory(earlier, turn("t2", "More?", []), "a")[0]).toEqual({
      role: "user",
      content: "/sleep last week",
    });
  });

  test("failed, stopped, withheld, declined, empty or missing answers leave the prompt alone", () => {
    const cases: readonly (AnswerState | null)[] = [
      answer("a", { status: "FAILED" }),
      answer("a", { status: "FAILED", stopped: true }),
      answer("a", { document: WITHHELD }),
      answer("a", { document: DECLINED }),
      answer("a", { text: "  " }),
      answer("a", { status: "STREAMING" }),
      null,
    ];
    for (const each of cases) {
      const earlier = [turn("t1", "Earlier?", each === null ? [answer("b")] : [each])];
      expect(modelHistory(earlier, turn("t2", "Now?", []), "a")).toEqual([
        { role: "user", content: "Earlier?" },
        { role: "user", content: "Now?" },
      ]);
    }
  });

  test("a leaked thinking block never goes back to the model", () => {
    const earlier = [
      turn("t1", "Q?", [answer("a", { text: "<think>hidden</think>Visible answer." })]),
    ];
    expect(modelHistory(earlier, turn("t2", "Now?", []), "a")[1]).toEqual({
      role: "assistant",
      content: "Visible answer.",
    });
  });

  test("historyForTurn uses the turns before the named one", () => {
    const turns = [
      turn("t1", "One?", [answer("a")]),
      turn("t2", "Two?", [answer("a")]),
      turn("t3", "Three?", []),
    ];
    expect(historyForTurn(turns, "t2", "a").map((message) => message.content)).toEqual([
      "One?",
      "a says 72 bpm.",
      "Two?",
    ]);
  });

  test("at most 100 messages, starting on a prompt", () => {
    const earlier = Array.from({ length: 80 }, (_, index) =>
      turn(`t${index}`, `Q${index}`, [answer("a")]),
    );
    const messages = modelHistory(earlier, turn("now", "Last?", []), "a");
    expect(messages.length).toBeLessThanOrEqual(100);
    expect(messages[0]?.role).toBe("user");
    expect(messages.at(-1)).toEqual({ role: "user", content: "Last?" });
  });
});
