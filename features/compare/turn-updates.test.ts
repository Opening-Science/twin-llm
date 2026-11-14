import { describe, expect, test } from "bun:test";

import type { StreamResult } from "./answer-stream";
import type { AnswerState, PromptSend, TurnState } from "./conversation";
import {
  answersToStream,
  confirmedTurn,
  finishedAnswer,
  incognitoTurn,
  provisionalTurn,
  retriedAnswer,
  scheduledStillWriting,
  stoppedAnswer,
  summariesOf,
  withAnswer,
  withProgress,
  withScheduledFrom,
  withTurnReplaced,
} from "./turn-updates";

const SEND: PromptSend = {
  prompt: "For synthetic subject 29bbf012, how did heart rate change?",
  models: [
    { id: "qwen3:4b", name: "Qwen3 4B" },
    { id: "agent:sleep", name: "Sleep specialist" },
  ],
  skill: null,
  effort: "balanced",
  label: "How did their heart rate change?",
};

const result = (over: Partial<StreamResult> = {}): StreamResult => ({
  text: "## Answer\nHeart rate fell from 78 to 72.5 bpm.",
  tools: [],
  views: [],
  profileFrame: null,
  reviewing: false,
  ending: "COMPLETE",
  refusal: null,
  metrics: {
    modelId: "qwen3:4b",
    timeToFirstTokenMs: 100,
    tokensPerSecond: 20,
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    costUsd: 0,
  },
  document: null,
  toolParts: [{ toolCallId: "call-1", input: {}, output: { rows: [{ value: 72.5 }] } }],
  aborted: false,
  ...over,
});

const NOW = new Date("2026-11-14T10:00:00.000Z");

describe("sending a turn (SPEC 2.3)", () => {
  test("the provisional turn has one streaming column per answerer", () => {
    const turn = provisionalTurn("provisional-1", SEND);
    expect(turn.provisional).toBe(true);
    expect(turn.label).toBe(SEND.label ?? undefined);
    expect(
      turn.answers.map((answer) => [answer.modelName, answer.status, answer.text]),
    ).toEqual([
      ["Qwen3 4B", "STREAMING", ""],
      ["Sleep specialist", "STREAMING", ""],
    ]);
    expect(answersToStream([turn])).toEqual([]);
  });

  test("the server's ids replace the provisional ones; the rest is kept", () => {
    const confirmed = confirmedTurn(provisionalTurn("p", SEND), {
      turnId: "turn-1",
      responses: [
        { id: "row-1", modelId: "qwen3:4b", modelName: "Qwen3 4B" },
        { id: "row-2", modelId: "agent:sleep", modelName: "Sleep specialist" },
      ],
    });
    expect(confirmed.provisional).toBeUndefined();
    expect(confirmed.id).toBe("turn-1");
    expect(confirmed.prompt).toBe(SEND.prompt);
    expect(confirmed.effort).toBe("balanced");
    expect(answersToStream([confirmed]).map(({ answer }) => answer.id)).toEqual([
      "row-1",
      "row-2",
    ]);
  });

  test("an incognito turn uses browser ids", () => {
    const turn = incognitoTurn("incognito-abc", SEND);
    expect(turn.answers.map((answer) => answer.id)).toEqual([
      "incognito-abc:qwen3:4b",
      "incognito-abc:agent:sleep",
    ]);
  });

  test("a failed write takes the provisional turn away", () => {
    expect(withTurnReplaced([provisionalTurn("p", SEND)], "p", null)).toEqual([]);
  });
});

describe("one column at a time (SPEC 2.7, 8)", () => {
  const turns: TurnState[] = [incognitoTurn("t", SEND)];
  const [first, second] = turns[0]?.answers ?? [];

  test("progress touches only its column", () => {
    const next = withAnswer(
      turns,
      first?.id ?? "",
      withProgress({ ...result(), reviewing: true }),
    );
    expect(next[0]?.answers[0]?.text).toContain("72.5");
    expect(next[0]?.answers[0]?.reviewing).toBe(true);
    expect(next[0]?.answers[1]).toBe(second as AnswerState);
  });

  test("a finished answer keeps metrics, number sources and time only when complete", () => {
    const done = finishedAnswer(first as AnswerState, result(), null, NOW);
    expect(done.status).toBe("COMPLETE");
    expect(done.completedAt).toBe(NOW.toISOString());
    expect(done.numberSources?.map((source) => source.text)).toContain("72.5");
    const lost = finishedAnswer(
      first as AnswerState,
      result({ ending: "LOST" }),
      null,
      NOW,
    );
    expect([lost.status, lost.lost, lost.metrics, lost.numberSources]).toEqual([
      "FAILED",
      true,
      null,
      undefined,
    ]);
    const refused = finishedAnswer(
      first as AnswerState,
      result({ ending: "FAILED", refusal: "No." }),
      null,
      NOW,
    );
    expect([refused.status, refused.refusal]).toEqual(["FAILED", "No."]);
  });

  test("Stop marks a streaming column; a finished one is left alone", () => {
    const stopped = stoppedAnswer({ ...(first as AnswerState), reviewing: true });
    expect([stopped.status, stopped.stopped, stopped.reviewing]).toEqual([
      "FAILED",
      true,
      false,
    ]);
    expect(finishedAnswer(stopped, result(), null, NOW)).toBe(stopped);
    const done = finishedAnswer(first as AnswerState, result(), null, NOW);
    expect(stoppedAnswer(done)).toBe(done);
  });

  test("Try again resets one column with nothing kept", () => {
    const done = finishedAnswer(
      first as AnswerState,
      result({ ending: "FAILED" }),
      null,
      NOW,
    );
    expect(retriedAnswer(done)).toEqual({
      id: done.id,
      modelId: done.modelId,
      modelName: done.modelName,
      status: "STREAMING",
      text: "",
      metrics: null,
    });
  });
});

describe("scheduled turns (SPEC 2.8)", () => {
  const scheduled: TurnState = { ...incognitoTurn("s", SEND), scheduled: true };

  test("still writing while any scheduled answer streams; never streamed by the browser", () => {
    expect(scheduledStillWriting([scheduled])).toBe(true);
    expect(answersToStream([scheduled])).toEqual([]);
    const settled = withAnswer([scheduled], scheduled.answers[0]?.id ?? "", (a) => ({
      ...a,
      status: "COMPLETE",
    }));
    expect(
      scheduledStillWriting(
        withAnswer(settled, scheduled.answers[1]?.id ?? "", (a) => ({
          ...a,
          status: "FAILED",
        })),
      ),
    ).toBe(false);
    expect(scheduledStillWriting([incognitoTurn("t", SEND)])).toBe(false);
  });

  test("a refreshed read replaces scheduled turns only", () => {
    const typed = incognitoTurn("t", SEND);
    const fresh = { ...scheduled, answers: [] };
    expect(withScheduledFrom([typed, scheduled], [fresh])).toEqual([typed, fresh]);
  });
});

test("summaries: missing or failing reads as none", () => {
  expect(summariesOf(null)).toBeNull();
  expect(summariesOf({ oura: null, whoop: "x" })).toEqual({
    oura: null,
    whoop: null,
    googleHealth: null,
    vitronic: null,
  });
});
