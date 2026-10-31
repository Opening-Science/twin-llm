import { describe, expect, test } from "bun:test";

import { VALUE_LEFT_OUT } from "@/infrastructure/twin-notes";

import {
  allowedNumbers,
  compactDraft,
  DRAFT_SYSTEM,
  draftPrompt,
  draftSourceOf,
  measureLines,
  parseDraftReply,
} from "./compact-draft";
import { SYNTHETIC_THREAD } from "./fixtures";

describe("draftSourceOf", () => {
  test("the first finished answer of the latest answered turn", () => {
    expect(draftSourceOf(SYNTHETIC_THREAD)).toEqual({
      turnId: "turn-2",
      modelId: "qwen3:4b",
      modelName: "Qwen3 4B",
      prompt: "And sleep?",
    });
  });

  test("none when nothing was answered", () => {
    expect(
      draftSourceOf({
        ...SYNTHETIC_THREAD,
        turns: [{ id: "t", prompt: "Hi", answers: [] }],
      }),
    ).toBeNull();
  });
});

describe("measureLines", () => {
  test("finished calls that named a measure, from their arguments, once each", () => {
    expect(measureLines(SYNTHETIC_THREAD)).toEqual([
      "8867-4 · trend · 1 Mar 2026 – 31 May 2026",
      "8867-4 · baseline_deviation · Baseline 1 Jan 2026 – 28 Feb 2026; Target 1 Mar 2026 – 31 May 2026",
      "93832-4 · summary_stats · no date range",
    ]);
  });
});

describe("allowedNumbers", () => {
  test("the person's own numbers and the measure codes", () => {
    expect([...allowedNumbers(SYNTHETIC_THREAD)].sort()).toEqual(
      ["012", "29", "2026", "8867-4", "93832-4"].sort(),
    );
  });
});

describe("draftPrompt", () => {
  test("prompts and each turn's first finished answer, Answer section only", () => {
    expect(draftPrompt(SYNTHETIC_THREAD)).toBe(
      [
        "Conversation:",
        "",
        "Person: How did heart rate change for synthetic subject 29bbf012 in spring 2026?",
        "Answer: Heart rate fell from 78 to 72.5 bpm.",
        "",
        "Person: And sleep?",
        "Answer: No sleep rows were found.",
      ].join("\n"),
    );
    expect(DRAFT_SYSTEM).toContain("Write no numbers");
  });

  test("a long thread keeps its newest turns", () => {
    const long = {
      ...SYNTHETIC_THREAD,
      turns: Array.from({ length: 20 }, (_, index) => ({
        id: `t${index}`,
        prompt: `Question ${index} ${"x".repeat(500)}`,
        answers: [],
      })),
    };
    const prompt = draftPrompt(long);
    expect(prompt).toContain("Question 19 ");
    expect(prompt).not.toContain("Question 0 ");
  });
});

describe("parseDraftReply", () => {
  test("the JSON object, with thinking and fences around it", () => {
    expect(
      parseDraftReply(
        '<think>hmm {"x":1}</think>```json\n{"topics": ["Heart rate"], "open_questions": ["Sleep"]}\n```',
      ),
    ).toEqual({ topics: ["Heart rate"], openQuestions: ["Sleep"] });
  });

  test("null for anything else", () => {
    expect(parseDraftReply("no json here")).toBeNull();
    expect(parseDraftReply('{"topics": "one"}')).toBeNull();
    expect(parseDraftReply("{broken")).toBeNull();
  });
});

describe("compactDraft", () => {
  test("model lines lose copied values; measures come from the calls", () => {
    expect(
      compactDraft(SYNTHETIC_THREAD, {
        topics: ["Heart rate 8867-4 fell to 72.5 bpm in 2026", "  "],
        openQuestions: ["Why were there no sleep rows after 12 May"],
      }),
    ).toEqual({
      title: "How did heart rate change in spring 2026? · subject 29bbf0",
      topics: [`Heart rate 8867-4 fell to ${VALUE_LEFT_OUT} bpm in 2026`],
      measures: measureLines(SYNTHETIC_THREAD),
      openQuestions: [`Why were there no sleep rows after ${VALUE_LEFT_OUT} May`],
    });
  });

  test("without a reply the topics are the person's own questions", () => {
    const draft = compactDraft(SYNTHETIC_THREAD, null);
    expect(draft.topics).toEqual([
      "How did heart rate change for synthetic subject 29bbf012 in spring 2026?",
      "And sleep?",
    ]);
    expect(draft.openQuestions).toEqual([]);
  });
});
