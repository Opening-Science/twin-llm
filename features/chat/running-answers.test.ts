import { describe, expect, test } from "bun:test";

import { createRunningAnswers, EARLY_STOP_MS } from "./running-answers";

const ANSWER = { turnId: "turn-1", modelId: "synthetic/model" };
const OTHER_MODEL = { turnId: "turn-1", modelId: "synthetic/other" };

describe("running answers (#373)", () => {
  test("Stop fires the signal of that turn and model, and no other", () => {
    const answers = createRunningAnswers();
    const stopped = answers.start(ANSWER);
    const other = answers.start(OTHER_MODEL);
    expect(answers.stop(ANSWER, true)).toBe(1);
    expect(stopped.signal.aborted).toBe(true);
    expect(other.signal.aborted).toBe(false);
  });

  test("two streams of one answer, as after a reload, both end", () => {
    const answers = createRunningAnswers();
    const first = answers.start(ANSWER);
    const second = answers.start(ANSWER);
    expect(answers.stop(ANSWER, true)).toBe(2);
    expect([first.signal.aborted, second.signal.aborted]).toEqual([true, true]);
  });

  test("a released answer is off the list, and a retry's entry stays on it", () => {
    const answers = createRunningAnswers();
    const stale = answers.start(ANSWER);
    const retry = answers.start(ANSWER);
    stale.release();
    stale.release();
    expect(stale.signal.aborted).toBe(false);
    expect(answers.stop(ANSWER, false)).toBe(1);
    expect(stale.signal.aborted).toBe(false);
    expect(retry.signal.aborted).toBe(true);
    retry.release();
    expect(answers.stop(ANSWER, false)).toBe(0);
  });

  test("a Stop ahead of its answer ends that answer once, when it starts", () => {
    const answers = createRunningAnswers();
    expect(answers.stop(ANSWER, true)).toBe(0);
    expect(answers.start(ANSWER).signal.aborted).toBe(true);
    expect(answers.start(ANSWER).signal.aborted).toBe(false);
  });

  test("a Stop for an answer that has ended is not held", () => {
    const answers = createRunningAnswers();
    expect(answers.stop(ANSWER, false)).toBe(0);
    expect(answers.start(ANSWER).signal.aborted).toBe(false);
  });

  test("a held Stop runs out", () => {
    const clock = { now: 1_000 };
    const answers = createRunningAnswers(() => clock.now);
    answers.stop(ANSWER, true);
    clock.now += EARLY_STOP_MS;
    expect(answers.start(ANSWER).signal.aborted).toBe(false);
  });
});
