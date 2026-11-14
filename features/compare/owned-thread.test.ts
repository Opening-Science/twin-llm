import { describe, expect, test } from "bun:test";

import { plainCipher } from "@/infrastructure/field-cipher";

import {
  inPickOrder,
  loadOwnedThread,
  type StoredThread,
  type ThreadReads,
} from "./owned-thread";
import { savedAnswer, type StoredAnswerRow, toAttribution } from "./saved-answer";

const ROW: StoredAnswerRow = {
  id: "r1",
  modelId: "qwen3:4b",
  modelName: "Qwen3 4B",
  status: "COMPLETE",
  text: "## Answer\nHeart rate averaged 72 bpm over 14 readings.",
  reasoningText: "Read the rows.",
  attribution: null,
  responseDocument: null,
  toolParts: [
    {
      seq: 1,
      tool: "summary_stats",
      input: { subject_ref: "29bbf012", loinc: "8867-4" },
      output: { mean: 72, n: 14, secret_value: 99 },
      argsSha256: "a",
      resultSha256: "b",
      rowCount: 14,
      at: "2026-11-01T00:00:00.000Z",
    },
  ],
  timeToFirstTokenMs: 420,
  tokensPerSecond: 31.5,
  inputTokens: 900,
  outputTokens: 120,
  totalTokens: 1020,
  costUsd: 0,
  completedAt: new Date("2026-11-01T00:00:05.000Z"),
};

describe("a saved answer row as answer state (SERVER-SPEC 3.6, SPEC 8.5)", () => {
  test("complete: cards with audit counts, number sources, metrics; no outputs", () => {
    const answer = savedAnswer(ROW);
    expect(answer.status).toBe("COMPLETE");
    expect(answer.tools?.map((card) => [card.id, card.rowCount])).toEqual([["1", 14]]);
    expect(answer.metrics?.totalTokens).toBe(1020);
    expect(answer.numberSources?.some((source) => source.toolCallId === "1")).toBe(true);
    expect(JSON.stringify(answer)).not.toContain("secret_value");
  });

  test("refused: failed, no text, the stored sentence, never asked again", () => {
    const answer = savedAnswer({
      ...ROW,
      status: "REFUSED",
      text: "This skill is not offered.",
    });
    expect(answer).toMatchObject({
      status: "FAILED",
      text: "",
      refusal: "This skill is not offered.",
      metrics: null,
    });
  });

  test("stopped: failed and stopped with its text, no metrics", () => {
    const answer = savedAnswer({ ...ROW, status: "STOPPED" });
    expect(answer.status).toBe("FAILED");
    expect(answer.stopped).toBe(true);
    expect(answer.text).toBe(ROW.text);
    expect(answer.metrics).toBeNull();
  });

  test("streaming: streams again with nothing kept", () => {
    expect(savedAnswer({ ...ROW, status: "STREAMING" })).toMatchObject({
      status: "STREAMING",
      text: "",
    });
  });

  test("withheld: no words, no reasoning, no views, no number sources", () => {
    const abstained = {
      schema_version: "twin-llm.response.v1" as const,
      intended_use: "research_hypothesis_generation_n_of_1" as const,
      not_for_diagnostic_use: true as const,
      sufficient_data: false,
      abstained: true,
      data_basis: {
        evidence_keys: [],
        hallucinated_keys: [],
        tool_calls: [],
        sources: { gbd: [], guidelines: [] },
        gbd_rows: [],
      },
      uncertainty: { model_statement: null },
      next_step: "more_data" as const,
      interpretation: { kind: "none" as const },
    };
    const answer = savedAnswer({ ...ROW, responseDocument: abstained });
    expect(answer.document?.abstained).toBe(true);
    expect(answer.text).toBe("");
    expect(answer.reasoningText).toBeNull();
    expect(answer.views).toEqual([]);
    expect(answer.numberSources).toEqual([]);
  });

  test("an invalid stored document is dropped and the answer reads as plain text", () => {
    const answer = savedAnswer({ ...ROW, responseDocument: { abstained: true } });
    expect(answer.document).toBeNull();
    expect(answer.text).toBe(ROW.text);
  });

  test("attribution is checked, not trusted", () => {
    expect(
      toAttribution([
        { metricKey: "oura.sleep", label: "Sleep", value: 7, source: "oura" },
        { metricKey: "oura.sleep", label: "Sleep", value: 7, source: "nowhere" },
        { label: "no key", value: 1 },
        "junk",
      ]),
    ).toEqual([
      { metricKey: "oura.sleep", label: "Sleep", value: 7, source: "oura" },
      { metricKey: "oura.sleep", label: "Sleep", value: 7 },
    ]);
  });

  test("answers in pick order; rows without a position after, as stored", () => {
    expect(
      inPickOrder([
        { id: "a", position: null },
        { id: "b", position: 1 },
        { id: "c", position: 0 },
        { id: "d", position: null },
      ]).map((row) => row.id),
    ).toEqual(["c", "b", "a", "d"]);
  });
});

const THREAD: StoredThread = {
  id: "thread-1",
  userId: "user-1",
  title: "Heart rate",
  turns: [
    {
      id: "turn-1",
      prompt: "How did heart rate change?",
      skill: null,
      label: null,
      scheduled: true,
      responses: [
        {
          ...ROW,
          position: 0,
          attribution: null,
          responseDocument: null,
          toolParts: null,
        },
      ],
    },
  ],
};

const reads = (over: Partial<ThreadReads> = {}): ThreadReads & { opened: string[] } => {
  const opened: string[] = [];
  return {
    opened,
    actorId: async () => "actor-1",
    appUserIdFor: async () => "user-1",
    readThread: async () => THREAD,
    cipherFor: async (userId) => {
      opened.push(userId);
      return plainCipher;
    },
    ...over,
  };
};

describe("who may read a thread (SERVER-SPEC 3.6)", () => {
  test("the owner reads it, shaped for the view", async () => {
    const thread = await loadOwnedThread("thread-1", reads());
    expect(thread?.title).toBe("Heart rate");
    expect(thread?.turns[0]).toMatchObject({
      id: "turn-1",
      skill: null,
      scheduled: true,
    });
    expect(thread?.turns[0]?.answers[0]?.modelName).toBe("Qwen3 4B");
  });

  test("anyone else, signed out, or no app user: nothing, and nothing opened", async () => {
    const other = reads({ appUserIdFor: async () => "user-2" });
    expect(await loadOwnedThread("thread-1", other)).toBeNull();
    expect(other.opened).toEqual([]);
    expect(
      await loadOwnedThread("thread-1", reads({ actorId: async () => null })),
    ).toBeNull();
    expect(
      await loadOwnedThread("thread-1", reads({ appUserIdFor: async () => null })),
    ).toBeNull();
    expect(
      await loadOwnedThread("thread-1", reads({ readThread: async () => null })),
    ).toBeNull();
  });
});
