import { describe, expect, test } from "bun:test";

import { lineKey, type LineRating } from "./rating-file";
import {
  blindLines,
  lineToken,
  raterLines,
  referenceLines,
  seededOrder,
} from "./rater-lines";

const ITEMS = [
  {
    id: "Q-1",
    question: "Is stroke more common after AF onset?",
    human: "Verdict raised.",
  },
  { id: "Q-2", question: "Am I going to have a stroke?" },
];

const KEY = {
  "Q-1": [
    { name: "verdict", value: "raised", refusal: null },
    { name: "age_adjusted_rate_ratio", value: 3.1, refusal: null },
  ],
};

const RUNS = [
  {
    runId: "run-model-a",
    lines: [
      { item_id: "Q-1", repeat: 1, error: null, text: "Higher after onset." },
      { item_id: "Q-2", repeat: 1, error: null, text: "I cannot say." },
      { item_id: "Q-1", repeat: 2, error: "TIMEOUT", text: null },
      { item_id: "Q-9", repeat: 1, error: null, text: "Not in the set." },
    ],
  },
  {
    runId: "run-model-b",
    lines: [{ item_id: "Q-1", repeat: 1, error: null, text: "Raised." }],
  },
];

describe("rater lines", () => {
  test("a token is 16 hex characters, fixed by run, item and repeat", () => {
    expect(lineToken("run-model-a", "Q-1", 1)).toMatch(/^[0-9a-f]{16}$/);
    expect(lineToken("run-model-a", "Q-1", 1)).toBe(lineToken("run-model-a", "Q-1", 1));
    expect(lineToken("run-model-a", "Q-1", 1)).not.toBe(
      lineToken("run-model-b", "Q-1", 1),
    );
  });

  test("references read as words", () => {
    expect(
      referenceLines([
        ...KEY["Q-1"],
        { name: "after_person_years", value: 22563.8, refusal: null },
        {
          name: "refusal",
          value: "DESIGN_NOT_SUPPORTED",
          refusal: "DESIGN_NOT_SUPPORTED",
        },
        { name: "rows", value: null, refusal: null },
      ]),
    ).toEqual([
      "Verdict: raised",
      "Age adjusted rate ratio: 3.1",
      "After person years: 22,563.8",
      "The tool refuses: DESIGN_NOT_SUPPORTED",
      "Rows: no value",
    ]);
  });

  test("answered lines of known items, from every run", () => {
    const lines = raterLines(RUNS, ITEMS, KEY);
    expect(lines.map((line) => [line.runId, line.itemId, line.repeat])).toEqual([
      ["run-model-a", "Q-1", 1],
      ["run-model-a", "Q-2", 1],
      ["run-model-b", "Q-1", 1],
    ]);
    expect(lines[1]).toEqual({
      token: lineToken("run-model-a", "Q-2", 1),
      runId: "run-model-a",
      itemId: "Q-2",
      repeat: 1,
      question: "Am I going to have a stroke?",
      answer: "I cannot say.",
      reference: [],
      note: null,
    });
  });

  test("the seed fixes the order; another seed gives another one", () => {
    const tokens = Array.from({ length: 12 }, (_, index) => ({ token: `t${index}` }));
    const a = seededOrder(tokens, "seed-a");
    expect(seededOrder([...tokens].reverse(), "seed-a")).toEqual(a);
    expect(seededOrder(tokens, "seed-b")).not.toEqual(a);
    expect([...a].sort((x, y) => x.token.localeCompare(y.token))).toEqual(
      [...tokens].sort((x, y) => x.token.localeCompare(y.token)),
    );
  });

  test("blind lines carry no run, item or model, and bring back earlier ratings", () => {
    const lines = raterLines(RUNS, ITEMS, KEY);
    const rating: LineRating = {
      item_id: "Q-1",
      repeat: 1,
      level: 4,
      comment: "paraphrase",
      rated_at: "2026-10-31T10:00:00.000Z",
    };
    const ratings = new Map([["run-model-b", new Map([[lineKey("Q-1", 1), rating]])]]);
    const blind = blindLines(lines, "seed", ratings);
    expect(blind.map((line) => Object.keys(line).sort())).toEqual(
      blind.map(() => [
        "answer",
        "comment",
        "level",
        "note",
        "question",
        "reference",
        "token",
      ]),
    );
    expect(JSON.stringify(blind)).not.toContain("run-model");
    const rated = blind.find((line) => line.token === lineToken("run-model-b", "Q-1", 1));
    expect([rated?.level, rated?.comment]).toEqual([4, "paraphrase"]);
    expect(blind.filter((line) => line.level === null).length).toBe(2);
  });
});
