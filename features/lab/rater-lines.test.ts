import { describe, expect, test } from "bun:test";

import { createHash } from "node:crypto";

import { lineKey, type LineRating } from "./rating-file";
import {
  blindLines,
  lineToken,
  raterLines,
  referenceKindOf,
  referenceLines,
  SALT_PATTERN,
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

const SALT = "a".repeat(64);
const OTHER_SALT = "b".repeat(64);

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
  test("a token is 16 hex characters, fixed by salt, run, item and repeat", () => {
    const token = lineToken(SALT, "run-model-a", "Q-1", 1);
    expect(token).toMatch(/^[0-9a-f]{16}$/);
    expect(lineToken(SALT, "run-model-a", "Q-1", 1)).toBe(token);
    expect(lineToken(SALT, "run-model-b", "Q-1", 1)).not.toBe(token);
    expect(lineToken(SALT, "run-model-a", "Q-1", 2)).not.toBe(token);
  });

  test("the same answer gets another token under another salt", () => {
    expect(lineToken(OTHER_SALT, "run-model-a", "Q-1", 1)).not.toBe(
      lineToken(SALT, "run-model-a", "Q-1", 1),
    );
  });

  test("the token is not the unsalted hash of #354", () => {
    const unsalted = createHash("sha256")
      .update("run-model-a\nQ-1\n1")
      .digest("hex")
      .slice(0, 16);
    expect(lineToken(SALT, "run-model-a", "Q-1", 1)).not.toBe(unsalted);
  });

  test("a salt is 64 lowercase hex characters", () => {
    expect(SALT_PATTERN.test(SALT)).toBe(true);
    expect(SALT_PATTERN.test("A".repeat(64))).toBe(false);
    expect(SALT_PATTERN.test("a".repeat(63))).toBe(false);
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
    const lines = raterLines(RUNS, ITEMS, KEY, SALT);
    expect(lines.map((line) => [line.runId, line.itemId, line.repeat])).toEqual([
      ["run-model-a", "Q-1", 1],
      ["run-model-a", "Q-2", 1],
      ["run-model-b", "Q-1", 1],
    ]);
    expect(lines[1]).toEqual({
      token: lineToken(SALT, "run-model-a", "Q-2", 1),
      runId: "run-model-a",
      itemId: "Q-2",
      repeat: 1,
      question: "Am I going to have a stroke?",
      answer: "I cannot say.",
      reference: [],
      referenceKind: "decline",
      note: null,
    });
  });

  test("the reference kind tells keyed, decline and lookup items apart (#304)", () => {
    const keyed = [{ name: "n", value: 3, refusal: null }];
    expect(referenceKindOf(keyed, "analytics")).toBe("keyed");
    expect(referenceKindOf(keyed, "declined_decision_support")).toBe("keyed");
    expect(referenceKindOf([], "declined_decision_support")).toBe("decline");
    expect(referenceKindOf([], undefined)).toBe("decline");
    expect(referenceKindOf([], "information")).toBe("unkeyed");
    const lines = raterLines(
      [{ runId: "run", lines: [{ item_id: "Q-3", repeat: 1, error: null, text: "x" }] }],
      [{ id: "Q-3", question: "Which DOI?", answerClass: "information" }],
      {},
      SALT,
    );
    expect(lines.map((line) => line.referenceKind)).toEqual(["unkeyed"]);
  });

  test("seed and salt fix the order; another seed or salt gives another one", () => {
    const tokens = Array.from({ length: 12 }, (_, index) => ({ token: `t${index}` }));
    const a = seededOrder(tokens, "seed-a", SALT);
    expect(seededOrder([...tokens].reverse(), "seed-a", SALT)).toEqual(a);
    expect(seededOrder(tokens, "seed-b", SALT)).not.toEqual(a);
    expect(seededOrder(tokens, "seed-a", OTHER_SALT)).not.toEqual(a);
    expect([...a].sort((x, y) => x.token.localeCompare(y.token))).toEqual(
      [...tokens].sort((x, y) => x.token.localeCompare(y.token)),
    );
  });

  test("blind lines carry no run, item or model, and bring back earlier ratings", () => {
    const lines = raterLines(RUNS, ITEMS, KEY, SALT);
    const rating: LineRating = {
      item_id: "Q-1",
      repeat: 1,
      level: 4,
      comment: "paraphrase",
      rated_at: "2026-10-31T10:00:00.000Z",
    };
    const ratings = new Map([["run-model-b", new Map([[lineKey("Q-1", 1), rating]])]]);
    const blind = blindLines(lines, "seed", SALT, ratings);
    expect(blind.map((line) => Object.keys(line).sort())).toEqual(
      blind.map(() => [
        "answer",
        "comment",
        "level",
        "note",
        "question",
        "reference",
        "referenceKind",
        "token",
      ]),
    );
    expect(JSON.stringify(blind)).not.toContain("run-model");
    expect(JSON.stringify(blind)).not.toContain(SALT);
    const rated = blind.find(
      (line) => line.token === lineToken(SALT, "run-model-b", "Q-1", 1),
    );
    expect([rated?.level, rated?.comment]).toEqual([4, "paraphrase"]);
    expect(blind.filter((line) => line.level === null).length).toBe(2);
  });
});
