import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PROVIDER_NOT_PERMITTED_SENTENCE } from "@/infrastructure/data-mode-policy";

import { AnswerColumn } from "./answer-column";
import type { TurnState } from "./conversation";
import { type SavedResponseRow, toSavedResponseState } from "./saved-response-state";
import { answersToStream } from "./turn-updates";

/** Synthetic rows of one turn: one model refused by a skill rule, one by the data-mode policy. */
const SKILL_SENTENCE =
  "/sleep runs only on local Ollama. The models here come from OpenRouter, so /sleep did not run. Ask without /sleep instead.";

const refusedRow = (id: string, text: string): SavedResponseRow => ({
  id,
  modelId: `synthetic/${id}`,
  modelName: `Synthetic ${id}`,
  position: 0,
  status: "REFUSED",
  text,
  reasoningText: null,
  attribution: null,
  responseDocument: null,
  toolParts: null,
  timeToFirstTokenMs: null,
  tokensPerSecond: null,
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  costUsd: 0,
  completedAt: new Date("2026-10-27T09:00:00.000Z"),
});

describe("a refused answer on reload", () => {
  test("reads as a failed answer carrying the stored sentence and no text", () => {
    expect(toSavedResponseState(refusedRow("r-1", SKILL_SENTENCE))).toEqual({
      id: "r-1",
      modelId: "synthetic/r-1",
      modelName: "Synthetic r-1",
      status: "FAILED",
      text: "",
      refusal: SKILL_SENTENCE,
      completedAt: "2026-10-27T09:00:00.000Z",
      metrics: null,
    });
  });

  test("is not streamed again: no model is asked when the thread opens", () => {
    const turn: TurnState = {
      id: "turn-1",
      prompt: "/sleep last 7 nights",
      skill: "sleep",
      answers: [
        toSavedResponseState(refusedRow("r-1", SKILL_SENTENCE)),
        toSavedResponseState(refusedRow("r-2", PROVIDER_NOT_PERMITTED_SENTENCE)),
      ],
    };
    expect(answersToStream([turn], new Set())).toEqual([]);
  });

  test("the column shows the stored sentence, the same one the live refusal showed", () => {
    const markup = renderToStaticMarkup(
      createElement(AnswerColumn, {
        response: toSavedResponseState(
          refusedRow("r-2", PROVIDER_NOT_PERMITTED_SENTENCE),
        ),
        wearables: { oura: null, whoop: null, googleHealth: null, vitronic: null },
        onRetry: () => {},
      }),
    );
    expect(markup).toContain("This model did not run");
    expect(markup).toContain(PROVIDER_NOT_PERMITTED_SENTENCE);
    expect(markup).not.toContain("No answer came back from this model");
  });
});
