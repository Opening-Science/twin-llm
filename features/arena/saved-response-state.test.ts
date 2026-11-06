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
        prompt: "/sleep last 7 nights",
        wearables: { oura: null, whoop: null, googleHealth: null, vitronic: null },
        onRetry: () => {},
      }),
    );
    expect(markup).toContain("This model did not run");
    expect(markup).toContain(PROVIDER_NOT_PERMITTED_SENTENCE);
    expect(markup).not.toContain("No answer came back from this model");
  });
});

describe("a stopped answer on reload (#373)", () => {
  const row: SavedResponseRow = {
    ...refusedRow(
      "s-1",
      "## Reasoning\nThe model working it out\n\n## Answer\nWhat it wrote before Stop\n",
    ),
    status: "STOPPED",
  };

  test("reads as stopped with its text, not as an error, and has no metrics", () => {
    const state = toSavedResponseState(row);
    expect(state.status).toBe("FAILED");
    expect(state.stopped).toBe(true);
    expect(state.text).toBe(row.text);
    expect(state.metrics).toBe(null);
    expect(state.refusal).toBe(undefined);
  });

  test("the column shows the text and says it was stopped, with no alert", () => {
    const markup = renderToStaticMarkup(
      createElement(AnswerColumn, {
        response: toSavedResponseState(row),
        prompt: "How is my heart rate?",
        wearables: { oura: null, whoop: null, googleHealth: null, vitronic: null },
        onRetry: () => undefined,
      }),
    );
    expect(markup).toContain("What it wrote before Stop");
    expect(markup).not.toContain("The model working it out");
    expect(markup).toContain("You stopped this answer");
    expect(markup).not.toContain('role="alert"');
  });

  test("stopped before any Answer section, the column says only that", () => {
    const markup = renderToStaticMarkup(
      createElement(AnswerColumn, {
        response: toSavedResponseState({
          ...row,
          text: "Okay, so the user wants me to explain this.",
        }),
        prompt: "How is my heart rate?",
        wearables: { oura: null, whoop: null, googleHealth: null, vitronic: null },
        onRetry: () => undefined,
      }),
    );
    expect(markup).not.toContain("the user wants me");
    expect(markup).not.toContain("wrote no answer");
    expect(markup).toContain("You stopped this answer");
  });

  test("is not streamed again when the thread opens", () => {
    const turn: TurnState = {
      id: "t-1",
      prompt: "p",
      answers: [toSavedResponseState(row)],
    };
    expect(answersToStream([turn], new Set())).toEqual([]);
  });
});
