import { describe, expect, test } from "bun:test";

import type { ResponseState, TurnState } from "./conversation";
import { historyFor } from "./turn-history";

const answer = (
  modelId: string,
  status: ResponseState["status"],
  text: string,
): ResponseState => ({
  id: `${modelId}-response`,
  modelId,
  modelName: modelId,
  status,
  text,
  metrics: null,
});

const turns: TurnState[] = [
  {
    id: "turn-1",
    prompt: "Synthetic question one",
    answers: [
      answer("model-a", "COMPLETE", "A answers one"),
      answer("model-b", "FAILED", ""),
    ],
  },
  {
    id: "turn-2",
    prompt: "Synthetic question two",
    answers: [answer("model-a", "COMPLETE", ""), answer("model-b", "COMPLETE", "B two")],
  },
  { id: "turn-3", prompt: "Synthetic question three", answers: [] },
];

describe("historyFor", () => {
  test("a model sees every prompt and only its own finished answers", () => {
    expect(historyFor(turns, 2, "model-a")).toEqual([
      { role: "user", content: "Synthetic question one" },
      { role: "assistant", content: "A answers one" },
      { role: "user", content: "Synthetic question two" },
      { role: "user", content: "Synthetic question three" },
    ]);
    expect(historyFor(turns, 2, "model-b")).toEqual([
      { role: "user", content: "Synthetic question one" },
      { role: "user", content: "Synthetic question two" },
      { role: "assistant", content: "B two" },
      { role: "user", content: "Synthetic question three" },
    ]);
  });

  test("the first turn is just its prompt", () => {
    expect(historyFor(turns, 0, "model-a")).toEqual([
      { role: "user", content: "Synthetic question one" },
    ]);
  });

  test("an earlier skill turn reads back with its command; the current one does not", () => {
    const skillTurns: TurnState[] = [
      { ...turns[0]!, skill: "sleep", prompt: "last 30 nights" },
      { ...turns[2]!, skill: "sleep", prompt: "last 7 nights" },
    ];
    expect(historyFor(skillTurns, 1, "model-a")).toEqual([
      { role: "user", content: "/sleep last 30 nights" },
      { role: "assistant", content: "A answers one" },
      { role: "user", content: "last 7 nights" },
    ]);
  });
});
