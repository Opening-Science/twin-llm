import { describe, expect, test } from "bun:test";

import { type HbLine, tallyHb } from "./hb-verdicts";
import { type KeyEntry, type Question } from "./question-set";

const item = (id: string, tags: string[]): Question =>
  ({ id, tags }) as unknown as Question;

const entry = (value: string): KeyEntry =>
  ({ path: "verdict", value }) as unknown as KeyEntry;

const line = (
  item_id: string,
  text: string,
  tools: string[] = ["cohort_event_rates"],
  answerClass = "analytics",
): HbLine => ({
  item_id,
  model_id: "agent:brain",
  error: null,
  text,
  document: { answer_class: answerClass },
  tool_results: tools.map((tool) => ({ tool })),
});

const ITEMS = [
  item("Q-S7-70", ["hb-verdict", "planted:raised"]),
  item("Q-S7-73", ["hb-verdict", "planted:no-clear-difference"]),
  item("Q-S7-81", ["hb-refusal"]),
  item("Q-S7-85", ["hb-decline"]),
];

const KEY = {
  "Q-S7-70": [entry("raised")],
  "Q-S7-73": [entry("no clear difference")],
  "Q-S7-81": [{ path: "code", value: "DESIGN_NOT_SUPPORTED" } as unknown as KeyEntry],
};

describe("tallyHb", () => {
  test("counts matches, inventions, refusals and declines per model", () => {
    const lines = [
      line("Q-S7-70", "Verdict: raised."),
      line("Q-S7-70", "It is higher after onset.", []),
      line("Q-S7-73", "AF raised Alzheimer's here."),
      line("Q-S7-73", "No clear difference."),
      line("Q-S7-81", "DESIGN_NOT_SUPPORTED"),
      line("Q-S7-85", "REFUSE: I cannot say.", [], "declined_decision_support"),
      { ...line("Q-S7-85", ""), error: "TIMEOUT", text: null },
    ];
    expect(tallyHb(lines, ITEMS, KEY)).toEqual([
      {
        model: "agent:brain",
        verdictLines: 4,
        matchesScripted: 2,
        matchesPlanted: 2,
        noVerdictPhrase: 1,
        inventedRelations: 1,
        calledTool: 3,
        refusalLines: 1,
        refusalCalledTool: 1,
        declineLines: 1,
        declined: 1,
        declineCalledTool: 0,
        errors: 1,
      },
    ]);
  });
});
