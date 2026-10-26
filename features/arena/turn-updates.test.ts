import { describe, expect, test } from "bun:test";

import type { TurnState } from "./conversation";
import {
  answersToStream,
  confirmTurn,
  dropPending,
  pendingTurn,
  restartResponse,
  updateResponse,
} from "./turn-updates";

const saved: TurnState = {
  id: "turn-1",
  prompt: "Synthetic question one",
  answers: [
    {
      id: "r-a",
      modelId: "model-a",
      modelName: "Model A",
      status: "FAILED",
      text: "partial",
      metrics: null,
      lost: true,
      tools: [
        {
          id: "c1",
          tool: "query_observations",
          title: "Query observations",
          args: [],
          state: "error",
          rowCount: null,
          note: null,
        },
      ],
    },
    {
      id: "r-b",
      modelId: "model-b",
      modelName: "Model B",
      status: "STREAMING",
      text: "",
      metrics: null,
    },
  ],
};

const pending = pendingTurn("Synthetic question two", [
  { id: "model-a", name: "Model A" },
]);

describe("turn updates", () => {
  test("a pending turn streams nothing until the server confirms it", () => {
    expect(answersToStream([saved, pending], new Set())).toEqual([
      { turnIndex: 0, turnId: "turn-1", response: saved.answers[1]! },
    ]);
    expect(answersToStream([saved, pending], new Set(["r-b"]))).toEqual([]);

    const confirmed = confirmTurn([saved, pending], "turn-2", [
      { id: "r-c", modelId: "model-a", modelName: "Model A" },
    ]);
    expect(confirmed[1]).toEqual({
      id: "turn-2",
      prompt: "Synthetic question two",
      answers: [
        {
          id: "r-c",
          modelId: "model-a",
          modelName: "Model A",
          status: "STREAMING",
          text: "",
          metrics: null,
        },
      ],
    });
    expect(
      answersToStream(confirmed, new Set(["r-b"])).map((a) => a.response.id),
    ).toEqual(["r-c"]);
  });

  test("a refused send removes only the pending turn", () => {
    expect(dropPending([saved, pending])).toEqual([saved]);
  });

  test("a retry resets one column and leaves the other alone", () => {
    const retried = updateResponse([saved], "r-a", restartResponse);
    expect(retried[0]!.answers).toEqual([
      {
        id: "r-a",
        modelId: "model-a",
        modelName: "Model A",
        status: "STREAMING",
        text: "",
        metrics: null,
      },
      saved.answers[1]!,
    ]);
  });
});
