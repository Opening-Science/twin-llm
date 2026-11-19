import { describe, expect, test } from "bun:test";

import type { AnswerState, TurnState } from "./conversation";
import { spokenAnswer } from "./spoken-turn";

const answer = (over: Partial<AnswerState>): AnswerState => ({
  id: "t1:m1",
  modelId: "m1",
  modelName: "Model one",
  status: "COMPLETE",
  text: "Answer: Here is your heart on the twin.\n\nUncertainty: Synthetic data.",
  metrics: null,
  ...over,
});

const turn = (answers: readonly AnswerState[]): TurnState => ({
  id: "t1",
  prompt: "Show me my heart.",
  answers,
});

describe("spokenAnswer", () => {
  test("the finished answer's Answer section, to read aloud", () => {
    expect(spokenAnswer([turn([answer({})])], { index: 0, language: "en" })).toEqual({
      id: "t1:m1",
      text: "Here is your heart on the twin.",
      prompt: "Show me my heart.",
      shownFocus: null,
    });
  });

  test("nothing for a typed turn or one not there yet", () => {
    expect(spokenAnswer([turn([answer({})])], null)).toBeNull();
    expect(spokenAnswer([], { index: 0, language: "en" })).toBeNull();
  });

  test("waits while answers stream, and skips failed, stopped and refused ones", () => {
    const spoken = { index: 0, language: "de" } as const;
    expect(spokenAnswer([turn([answer({ status: "STREAMING" })])], spoken)).toBeNull();
    expect(
      spokenAnswer(
        [
          turn([
            answer({ id: "a", status: "FAILED" }),
            answer({ id: "b", stopped: true }),
            answer({ id: "c", refusal: "Not on this model." }),
            answer({ id: "d", text: "Answer: Dein Herz." }),
          ]),
        ],
        spoken,
      )?.id,
    ).toBe("d");
  });

  test("an answer with no words is not read", () => {
    expect(
      spokenAnswer([turn([answer({ text: "" })])], { index: 0, language: "en" }),
    ).toBeNull();
  });
});
