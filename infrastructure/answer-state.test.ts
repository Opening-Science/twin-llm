import { describe, expect, test } from "bun:test";

import { AnswerState, ModelResponseStatus } from "@/generated/prisma/client";

import { stateOf, statusOf } from "./answer-state";

describe("answer state and status", () => {
  test("every status has its state and back", () => {
    for (const status of Object.values(ModelResponseStatus)) {
      expect(stateOf(status)).toBe(status.toLowerCase() as AnswerState);
      expect(statusOf(stateOf(status))).toBe(status);
    }
  });

  test("every state the answers table holds has a status", () => {
    for (const state of Object.values(AnswerState)) {
      expect(stateOf(statusOf(state))).toBe(state);
    }
  });
});
